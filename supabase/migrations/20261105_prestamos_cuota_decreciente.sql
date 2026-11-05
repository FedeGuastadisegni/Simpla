-- Cuota decreciente (sistema alemán) en préstamos.
-- Idempotente: se puede correr de nuevo. No borra filas.
-- Correr en el SQL Editor. schema.sql de una base nueva ya incluye estas columnas;
-- este archivo es para la base que ya existe.
-- No aplica la proyección: adjust_bank queda en false.

alter table public.loans add column if not exists amortization text;
alter table public.loans add column if not exists remaining_principal numeric(14, 2);
alter table public.loans add column if not exists tem numeric(9, 6);
alter table public.loans add column if not exists cft numeric(9, 4);
alter table public.loans add column if not exists current_installment_bank numeric(14, 2);
alter table public.loans add column if not exists adjust_bank boolean;

update public.loans
set amortization = 'fija'
where amortization is null or amortization not in ('fija', 'aleman');

update public.loans
set adjust_bank = false
where adjust_bank is null;

alter table public.loans alter column amortization set default 'fija';
alter table public.loans alter column amortization set not null;
alter table public.loans alter column adjust_bank set default false;
alter table public.loans alter column adjust_bank set not null;

alter table public.loans drop constraint if exists loans_amortization_check;
alter table public.loans
  add constraint loans_amortization_check
  check (amortization in ('fija', 'aleman'));

alter table public.loans drop constraint if exists loans_remaining_principal_check;
alter table public.loans
  add constraint loans_remaining_principal_check
  check (remaining_principal is null or remaining_principal >= 0);

alter table public.loans drop constraint if exists loans_tem_check;
alter table public.loans
  add constraint loans_tem_check
  check (tem is null or tem >= 0);

alter table public.loans drop constraint if exists loans_cft_check;
alter table public.loans
  add constraint loans_cft_check
  check (cft is null or cft >= 0);

alter table public.loans drop constraint if exists loans_current_installment_bank_check;
alter table public.loans
  add constraint loans_current_installment_bank_check
  check (current_installment_bank is null or current_installment_bank >= 0);

comment on column public.loans.tem is
  'Tasa efectiva mensual, en porcentaje. 5 significa 5%.';

comment on column public.loans.cft is
  'Costo financiero total, en porcentaje. Solo se muestra: no entra en la proyección.';

comment on column public.loans.current_installment_bank is
  'Cuota que informa el banco este mes. Si no coincide con el cálculo, la diferencia puede ser IVA sobre intereses o seguro.';

comment on column public.loans.adjust_bank is
  'Si es true, cada cuota proyectada suma la diferencia fija entre la cuota del banco y el cálculo. Por defecto, apagado.';
