-- Actas de devolución: al devolver una consignación (o un memo de dealer) a su dueño, o al recibir de
-- vuelta un reloj entregado en memo, se genera un documento para que lo firme la otra parte.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-28-expenses-market.sql
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment', 'purchase', 'sourcing', 'proforma', 'return'));

-- Qué se devuelve: 'consignment' (devolvemos al dueño o dealer su reloj) o 'memo' (nos devuelven el nuestro)
alter table documents add column if not exists return_of text;
