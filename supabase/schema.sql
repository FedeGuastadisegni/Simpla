-- Simpla. Pegar una vez en el SQL Editor de Supabase.
-- Se puede correr de nuevo: no borra filas.
-- Los montos en USD se guardan en USD. No hay conversión a pesos.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'fedeguastadisegni@gmail.com';
$$;

create or replace function public.reject_foreign_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) is distinct from 'fedeguastadisegni@gmail.com' then
    raise exception 'Esta app es privada';
  end if;
  return new;
end;
$$;

revoke all on function public.is_allowed_user() from public;
revoke all on function public.set_updated_at() from public;
revoke all on function public.reject_foreign_email() from public;
grant execute on function public.is_allowed_user() to authenticated;
grant execute on function public.set_updated_at() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.reject_foreign_email() to supabase_auth_admin';
  end if;
end
$$;

drop trigger if exists reject_foreign_email on auth.users;
create trigger reject_foreign_email
  before insert or update of email on auth.users
  for each row
  execute function public.reject_foreign_email();

-- Tarjeta: nombre y día de vencimiento.
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  due_day smallint not null check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Compra en la tarjeta. USD queda en USD.
-- installment_* en null si es un pago solo.
create table if not exists public.card_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid not null,
  description text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null check (currency in ('ARS', 'USD')),
  spent_on date not null,
  installment_number integer,
  installment_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (card_id, user_id) references public.cards (id, user_id) on delete cascade,
  check (
    (installment_number is null and installment_count is null)
    or (
      installment_number >= 1
      and installment_count >= 1
      and installment_number <= installment_count
    )
  )
);

comment on column public.card_items.currency is
  'ARS o USD. Los USD se guardan y se muestran en USD, sin convertir a pesos.';

-- Préstamo: la cuota, cuántas faltan y cuándo termina.
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  installment_amount numeric(14, 2) not null check (installment_amount >= 0),
  remaining_installments integer not null check (remaining_installments >= 0),
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Servicio: nombre y categoría (luz, gas, internet…).
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  category text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Factura de un servicio. period es YYYY-MM.
create table if not exists public.service_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service_id uuid not null,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric(14, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (service_id, user_id) references public.services (id, user_id) on delete cascade
);

-- Suscripción. frequency: mensual o anual. next_charge_on es el próximo cobro.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null check (currency in ('ARS', 'USD')),
  frequency text not null check (frequency in ('mensual', 'anual')),
  next_charge_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.subscriptions.currency is
  'ARS o USD. Los USD se guardan y se muestran en USD, sin convertir a pesos.';

-- Gastos diarios. Vacía hasta la v2.
-- source: manual, notificacion o mail.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spent_on date not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null check (currency in ('ARS', 'USD')),
  description text not null,
  category text not null,
  source text not null check (source in ('manual', 'notificacion', 'mail')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.expenses.currency is
  'ARS o USD. Los USD se guardan y se muestran en USD, sin convertir a pesos.';

create index if not exists cards_user_id_idx on public.cards (user_id);
create index if not exists card_items_user_id_idx on public.card_items (user_id);
create index if not exists card_items_card_id_idx on public.card_items (card_id);
create index if not exists loans_user_id_idx on public.loans (user_id);
create index if not exists services_user_id_idx on public.services (user_id);
create index if not exists service_bills_user_id_idx on public.service_bills (user_id);
create index if not exists service_bills_service_id_idx on public.service_bills (service_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists expenses_user_id_idx on public.expenses (user_id);

do $$
declare
  t text;
  tables text[] := array[
    'cards',
    'card_items',
    'loans',
    'services',
    'service_bills',
    'subscriptions',
    'expenses'
  ];
begin
  foreach t in array tables
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at',
      t
    );

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      t
    );

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid() and public.is_allowed_user())',
      t || '_select',
      t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid() and public.is_allowed_user())',
      t || '_insert',
      t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = auth.uid() and public.is_allowed_user()) with check (user_id = auth.uid() and public.is_allowed_user())',
      t || '_update',
      t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = auth.uid() and public.is_allowed_user())',
      t || '_delete',
      t
    );
  end loop;
end
$$;
