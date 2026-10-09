-- Cotizaciones, memos y facturas. Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-13-links.sql

create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('quote', 'memo', 'invoice')),
  number         text not null unique,                 -- Q-2026-0001 · M-2026-0001 · INV-2026-0001
  status         text not null default 'draft',        -- draft | sent | accepted | rejected | returned | paid | void | converted
  customer_id    uuid references customers(id),
  -- Datos del cliente tal como salen en el documento (no cambian si luego se edita la ficha)
  client_name    text,
  client_company text,
  client_email   text,
  client_phone   text,
  client_address text,
  lang           text not null default 'en',
  issue_date     date not null default current_date,
  due_date       date,                                 -- cotización: válida hasta · memo: devolver antes de · factura: vence
  items          jsonb not null default '[]',          -- [{ item_id, sku, title, details, serial, qty, price }]
  discount       numeric(12, 2) not null default 0,
  tax_rate       numeric(6, 3) not null default 0,     -- %
  shipping       numeric(12, 2) not null default 0,
  subtotal       numeric(12, 2) not null default 0,
  total          numeric(12, 2) not null default 0,
  show_serial    boolean not null default true,
  notes          text,
  terms          text,
  payment_method text,
  paid_at        date,
  token          text not null unique,                 -- enlace privado para el cliente (/d/…)
  source_id      uuid references documents(id),        -- cotización o memo del que salió
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists documents_kind_idx on documents (kind, created_at desc);
create index if not exists documents_customer_idx on documents (customer_id);

-- Solo el servidor accede (el CRM comprueba el usuario; el enlace del cliente se lee por su token)
alter table documents enable row level security;
