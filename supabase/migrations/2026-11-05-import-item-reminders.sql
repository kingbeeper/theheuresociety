-- 3) Facturas importadas (de antes del CRM): de qué archivo vienen
-- 4) Recordatorios enlazados a una pieza del inventario (p. ej. «el vendedor me debe la caja»)
-- Ejecutar en Supabase > SQL Editor

alter table documents add column if not exists imported_from text;

alter table reminders add column if not exists item_id uuid references inventory_items(id) on delete set null;
create index if not exists reminders_item_idx on reminders (item_id);
