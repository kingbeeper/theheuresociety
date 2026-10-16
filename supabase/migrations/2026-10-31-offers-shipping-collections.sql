-- 1) Tasar una oferta de cliente: precio de mercado guardado en la oferta
-- 2) Envíos: número de rastreo de FedEx/UPS/USPS/DHL en facturas, memos, etc., con aviso al cliente
-- 3) Cobros pendientes: cuándo se le recordó el pago al cliente
-- Ejecutar en Supabase > SQL Editor

alter table sell_requests add column if not exists market_low        numeric(12, 2);
alter table sell_requests add column if not exists market_typical    numeric(12, 2);
alter table sell_requests add column if not exists market_high       numeric(12, 2);
alter table sell_requests add column if not exists market_listings   integer;
alter table sell_requests add column if not exists market_note       text;
alter table sell_requests add column if not exists market_sources    jsonb not null default '[]';
alter table sell_requests add column if not exists market_checked_at timestamptz;

create table if not exists shipments (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  carrier      text not null,                         -- fedex | ups | usps | dhl | other
  tracking     text not null,
  status       text not null default 'shipped',       -- shipped | delivered | returned
  note         text,
  shipped_at   timestamptz not null default now(),
  delivered_at timestamptz,
  notified     text[] not null default '{}',          -- avisos ya enviados al cliente: shipped, delivered
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists shipments_document_idx on shipments (document_id);
create index if not exists shipments_status_idx on shipments (status);
alter table shipments enable row level security;

alter table documents add column if not exists last_reminder_at timestamptz;
alter table documents add column if not exists reminder_count   integer not null default 0;
