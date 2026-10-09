-- Enlaces automáticos entre módulos. Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-12-inventory.sql

-- Reloj del inventario que vino de una solicitud de compra/consignación (tablero «Compras»)
alter table inventory_items add column if not exists sell_request_id uuid references sell_requests(id);
create index if not exists inventory_items_request_idx on inventory_items (sell_request_id);
