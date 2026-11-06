-- Medio de pago para proyectar servicios y suscripciones dentro de la tarjeta.
-- Ejecutar antes de publicar la aplicación. No modifica documentos ni importes.
begin;
alter table public.services add column if not exists card_id uuid;
alter table public.subscriptions add column if not exists card_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.services'::regclass and conname = 'services_card_fkey') then
    alter table public.services add constraint services_card_fkey
      foreign key (card_id, user_id) references public.cards (id, user_id)
      on delete set null (card_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.subscriptions'::regclass and conname = 'subscriptions_card_fkey') then
    alter table public.subscriptions add constraint subscriptions_card_fkey
      foreign key (card_id, user_id) references public.cards (id, user_id)
      on delete set null (card_id);
  end if;
end
$$;
create index if not exists services_card_idx on public.services (card_id, user_id) where card_id is not null;
create index if not exists subscriptions_card_idx on public.subscriptions (card_id, user_id) where card_id is not null;
comment on column public.services.card_id is
  'Tarjeta que paga este servicio. Los importes se incluyen en la tarjeta y no se suman como pagos independientes.';
comment on column public.subscriptions.card_id is
  'Tarjeta para anticipar cargos cuando on_card es true. Los cargos reales reemplazan las estimaciones.';
commit;
