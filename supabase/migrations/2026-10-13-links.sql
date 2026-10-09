-- Enlaces automáticos entre módulos. Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-12-inventory.sql

-- Reloj del inventario que vino de una solicitud de compra/consignación (tablero «Compras»)
alter table inventory_items add column if not exists sell_request_id uuid references sell_requests(id);
create index if not exists inventory_items_request_idx on inventory_items (sell_request_id);

-- Seguimientos: «llamar a este cliente el día X» (aparece en el panel y en el resumen de Telegram)
alter table customers add column if not exists follow_up_at date;
alter table customers add column if not exists follow_up_note text;
create index if not exists customers_follow_up_idx on customers (follow_up_at) where follow_up_at is not null;
