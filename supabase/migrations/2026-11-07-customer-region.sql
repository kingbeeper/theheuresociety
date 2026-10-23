-- Región del cliente (para ofertas y correos por zona): miami, orlando, pr, rd, ny, boston, otra
-- Si está vacía, el CRM la sugiere por el teléfono o la dirección.
-- Ejecutar en Supabase > SQL Editor

alter table customers add column if not exists region text;
create index if not exists customers_region_idx on customers (region);
