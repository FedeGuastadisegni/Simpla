-- Día de cierre en tarjetas. Nullable: las tarjetas ya cargadas siguen
-- sin cierre y el mes del resumen no cambia.
-- Idempotente. Correr en el SQL Editor. schema.sql de una base nueva
-- ya incluye la columna.

alter table public.cards add column if not exists closing_day smallint;

alter table public.cards drop constraint if exists cards_closing_day_check;
alter table public.cards
  add constraint cards_closing_day_check
  check (closing_day is null or closing_day between 1 and 31);

comment on column public.cards.closing_day is
  'Día de cierre del resumen. Si está, un gasto posterior a ese día entra en el mes siguiente. Null: el mes es el de la fecha de compra.';
