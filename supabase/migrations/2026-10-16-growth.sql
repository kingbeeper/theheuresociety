-- Postventa, relojero, contrato de compra y correos. Ejecutar en Supabase > SQL Editor
-- DESPUÉS de 2026-10-15-consignment.sql

-- Tareas automáticas con clientes: pedir reseña, aniversario de compra, recordar el servicio…
create table if not exists customer_tasks (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  item_id     uuid references inventory_items(id) on delete set null,
  kind        text not null,                   -- review | anniversary | service | custom
  due_date    date not null,
  note        text,
  done_at     timestamptz,
  done_by     text,
  created_at  timestamptz not null default now(),
  unique (customer_id, item_id, kind)
);
create index if not exists customer_tasks_due_idx on customer_tasks (due_date) where done_at is null;
alter table customer_tasks enable row level security;

-- Relojes en el relojero (servicio, pulido, reparación)
create table if not exists item_services (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references inventory_items(id) on delete cascade,
  provider    text not null,
  work        text,
  sent_at     date not null default current_date,
  expected_at date,
  returned_at date,
  cost        numeric(12, 2),
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists item_services_open_idx on item_services (item_id) where returned_at is null;
alter table item_services enable row level security;

-- Contrato de compra (bill of sale): el vendedor y su identificación
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment', 'purchase'));
alter table documents add column if not exists seller_id_type text;
alter table documents add column if not exists seller_id_number text;   -- completo solo en el CRM; el documento muestra los 4 últimos
alter table documents add column if not exists seller_dob date;

-- Correos de novedades: baja voluntaria
alter table customers add column if not exists email_opt_out boolean not null default false;
