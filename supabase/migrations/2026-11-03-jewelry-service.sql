  -- 2) Inventario de joyería: tipo de pieza (reloj por defecto, joya u otro) y los datos de la joya
  -- 1) Orden de servicio: pulido o reparación de una pieza del cliente (nuevo tipo de documento «service»)
  -- Ejecutar en Supabase > SQL Editor
  
  alter table inventory_items add column if not exists category text not null default 'watch';
  alter table inventory_items drop constraint if exists inventory_items_category_check;
  alter table inventory_items add constraint inventory_items_category_check check (category in ('watch', 'jewelry', 'other'));
  -- Joya: tipo (anillo, cadena, aretes…), metal y color, piedra y quilates, talla o largo, peso
  alter table inventory_items add column if not exists jewelry jsonb;
  create index if not exists inventory_items_category_idx on inventory_items (category);
  
  alter table documents drop constraint if exists documents_kind_check;
  alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment', 'purchase', 'sourcing', 'proforma', 'return', 'inspection', 'service'));
  -- Orden de servicio: estado del trabajo, taller, costo del taller, fechas y fotos de la pieza recibida
  alter table documents add column if not exists service jsonb;
