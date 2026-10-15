-- Factura proforma: cotización aceptada con depósitos; al saldarse se genera la factura pagada.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-25-followup-time.sql
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment', 'purchase', 'sourcing', 'proforma'));

-- Pagos a cuenta de la proforma: [{ date, amount, method }]. `deposit` guarda la suma (y en la factura
-- final, lo que se pagó antes del último pago).
alter table documents add column if not exists payments jsonb not null default '[]';
