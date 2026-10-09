-- Inventario (control de stock, ventas y devoluciones). Ejecutar en Supabase > SQL Editor
-- DESPUÉS de 2026-10-11-social.sql. Datos privados: solo el CRM accede (nunca la web pública).

create sequence if not exists inventory_sku_seq;

create table if not exists inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  sku                text unique not null default ('THS-' || lpad(nextval('inventory_sku_seq')::text, 4, '0')),
  status             text not null default 'in_stock',   -- in_stock | reserved | sold | returned
  acquisition        text not null default 'purchase',   -- purchase | trade | consignment | memo

  -- El reloj (columnas de la plantilla INVENTORY CONTROL)
  brand              text not null,
  model              text,
  reference          text,                               -- Ref #
  serial             text,                               -- Serial #
  papers_date        date,                               -- Dated (fecha de la tarjeta/papeles)
  links              text,                               -- Links # (eslabones)
  condition          text,                               -- New | Unworn | Pre-Owned…
  comes_with         text,                               -- caja, papeles, etiquetas…
  description        text,

  -- Entrada: de quién y cuánto
  supplier_customer_id uuid references customers(id),
  supplier_name      text,                               -- Contact Name
  supplier_company   text,                               -- Company Name
  supplier_location  text,                               -- Location
  purchase_date      date,
  cost               numeric(12, 2),                     -- compra; en consignación/memo: lo que se paga al dueño al vender
  extra_costs        numeric(12, 2) not null default 0,  -- servicio, pulido, envío, comisiones…
  asking_price       numeric(12, 2),                     -- precio de venta previsto
  memo_due           date,                               -- memo: fecha límite para devolverlo al dealer
  trade_for_item_id  uuid references inventory_items(id),-- intercambio: entró como parte del pago de este reloj
  watch_id           uuid references watches(id),        -- ficha publicada en la web (si la hay)

  -- Venta (un solo pago)
  sale_date          date,
  sale_price         numeric(12, 2),
  buyer_customer_id  uuid references customers(id),
  buyer_name         text,                               -- Client
  payment_method     text,                               -- wire | zelle | cash | card | crypto | trade | other

  -- Consignación y memo: pago al dueño tras la venta
  owner_paid_at      date,

  -- Devolución
  return_date        date,
  return_reason      text,

  notes              text,                               -- Internal Notes
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists inventory_items_status_idx on inventory_items (status, purchase_date desc);
create index if not exists inventory_items_watch_idx on inventory_items (watch_id);

-- Historial de cada reloj: entrada, cambios de precio, reserva, venta, devolución, pagos…
create table if not exists inventory_events (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references inventory_items(id) on delete cascade,
  type        text not null,
  body        text,
  meta        jsonb not null default '{}',
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists inventory_events_item_idx on inventory_events (item_id, created_at desc);

alter table inventory_items  enable row level security;
alter table inventory_events enable row level security;
