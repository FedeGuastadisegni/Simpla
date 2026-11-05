-- Suscripción que ya se cobra en la tarjeta.
-- Idempotente: se puede correr de nuevo. No borra filas.
-- Correr en el SQL Editor. schema.sql de una base nueva ya incluye la columna;
-- este archivo es para la base que ya existe.
-- on_card true: se muestra en Suscripciones y no se suma a los fijos ni a la proyección.

alter table public.subscriptions
  add column if not exists on_card boolean not null default false;

comment on column public.subscriptions.on_card is
  'Si es true, el cobro ya entra en la tarjeta: se sigue el próximo vencimiento, pero no se suma a los fijos ni a la proyección.';
