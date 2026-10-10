-- Encargos con anticipo (Sourcing Agreement): el cliente deja un anticipo para que le consigamos
-- un reloj concreto. Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-20-social-growth.sql
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment', 'purchase', 'sourcing'));

-- Anticipo: en el encargo, lo que deja el cliente; en la factura que sale de él, lo que se descuenta del saldo
alter table documents add column if not exists deposit             numeric(12, 2) not null default 0;
alter table documents add column if not exists deposit_paid_at     date;
alter table documents add column if not exists deposit_method      text;
alter table documents add column if not exists refunded_at         date;          -- anticipo devuelto al cliente
