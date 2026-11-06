-- Períodos de tarjeta y vínculos para la futura clasificación de consumos.
-- Ejecutar antes de publicar la nueva aplicación. No guarda documentos ni
-- reconstruye períodos antiguos cuya fecha de vencimiento se desconoce.
begin;

alter table public.cards
  add column if not exists last_closing_on date,
  add column if not exists last_due_on date,
  add column if not exists next_closing_on date,
  add column if not exists next_due_on date;

alter table public.card_items
  add column if not exists statement_closes_on date,
  add column if not exists statement_due_on date,
  add column if not exists subscription_id uuid,
  add column if not exists service_bill_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.subscriptions'::regclass and conname = 'subscriptions_id_user_id_key') then
    alter table public.subscriptions add constraint subscriptions_id_user_id_key unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.service_bills'::regclass and conname = 'service_bills_id_user_id_key') then
    alter table public.service_bills add constraint service_bills_id_user_id_key unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cards'::regclass and conname = 'cards_statement_dates_check') then
    alter table public.cards add constraint cards_statement_dates_check check (
      ((last_closing_on is null and last_due_on is null) or
       (last_closing_on is not null and last_due_on is not null and last_due_on >= last_closing_on))
      and ((next_closing_on is null and next_due_on is null) or
       (next_closing_on is not null and next_due_on is not null and next_due_on >= next_closing_on))
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.card_items'::regclass and conname = 'card_items_statement_dates_check') then
    alter table public.card_items add constraint card_items_statement_dates_check check (
      statement_closes_on is null or
      (statement_due_on is not null and statement_due_on >= statement_closes_on)
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.card_items'::regclass and conname = 'card_items_single_link_check') then
    alter table public.card_items add constraint card_items_single_link_check check (
      num_nonnulls(subscription_id, service_bill_id) <= 1
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.card_items'::regclass and conname = 'card_items_subscription_fkey') then
    alter table public.card_items add constraint card_items_subscription_fkey
      foreign key (subscription_id, user_id) references public.subscriptions (id, user_id)
      on delete set null (subscription_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.card_items'::regclass and conname = 'card_items_service_bill_fkey') then
    alter table public.card_items add constraint card_items_service_bill_fkey
      foreign key (service_bill_id, user_id) references public.service_bills (id, user_id)
      on delete set null (service_bill_id);
  end if;
end
$$;

create index if not exists card_items_subscription_idx on public.card_items (subscription_id, user_id) where subscription_id is not null;
create index if not exists card_items_service_bill_idx on public.card_items (service_bill_id, user_id) where service_bill_id is not null;

comment on column public.card_items.statement_due_on is
  'Vencimiento de la cuota indicada en installment_number, o del consumo en un pago. No es la fecha original de compra.';
comment on column public.card_items.subscription_id is
  'Vínculo opcional con una suscripción del mismo usuario. La clasificación se incorpora en una etapa posterior.';
comment on column public.card_items.service_bill_id is
  'Vínculo opcional con una factura del mismo usuario; su período puede diferir del mes de pago de la tarjeta.';

commit;
