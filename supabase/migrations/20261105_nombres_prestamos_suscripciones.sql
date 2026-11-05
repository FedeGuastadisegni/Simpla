-- Nombres para préstamos y suscripciones.
-- Idempotente: se puede correr de nuevo. No borra filas.
-- Correr en el SQL Editor. schema.sql de una base nueva ya incluye estas columnas;
-- este archivo es para la base que ya existe.

alter table public.loans add column if not exists name text;
alter table public.subscriptions add column if not exists name text;

update public.loans
set name = 'Préstamo'
where name is null or btrim(name) = '';

update public.subscriptions
set name = 'Suscripción'
where name is null or btrim(name) = '';

alter table public.loans alter column name set not null;
alter table public.subscriptions alter column name set not null;
