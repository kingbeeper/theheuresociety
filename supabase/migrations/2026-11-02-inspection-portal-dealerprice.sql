-- 6) Ficha de inspección: nuevo tipo de documento «inspection» con la lista del estado del reloj y fotos
-- 1) Portal privado «Mi colección» de cada cliente (enlace con su token)
-- 3) Precio para dealers de cada reloj (lista de precios del gremio)
-- Ejecutar en Supabase > SQL Editor

alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment', 'purchase', 'sourcing', 'proforma', 'return', 'inspection'));
alter table documents add column if not exists inspection jsonb;

alter table customers add column if not exists portal_token text unique;

alter table inventory_items add column if not exists dealer_price numeric(12, 2);
