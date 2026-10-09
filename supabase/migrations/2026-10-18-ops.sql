-- Firma, identificación, ubicación y conteo, comisiones, tareas y pagos con tarjeta.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-17-users.sql

-- Archivos privados (firmas, fotos de identificación): sin acceso público, solo con enlace temporal del servidor
insert into storage.buckets (id, name, public) values ('private', 'private', false) on conflict (id) do nothing;

-- Firma electrónica del cliente y foto de la identificación del vendedor
alter table documents add column if not exists signed_at      timestamptz;
alter table documents add column if not exists signer_name    text;
alter table documents add column if not exists signature_path text;   -- en el bucket privado
alter table documents add column if not exists signed_ip      text;
alter table documents add column if not exists signed_ua      text;
alter table documents add column if not exists id_photo_path  text;   -- en el bucket privado

-- Dónde está cada reloj y cuándo se contó por última vez
alter table inventory_items add column if not exists location        text;   -- safe | showcase | office | client | other
alter table inventory_items add column if not exists location_note   text;
alter table inventory_items add column if not exists last_counted_at timestamptz;
alter table inventory_items add column if not exists sold_by         text;   -- correo del vendedor (comisiones)

create table if not exists inventory_counts (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  started_by  text,
  expected    uuid[] not null default '{}',
  found       uuid[] not null default '{}'
);
alter table inventory_counts enable row level security;

-- Comisiones y Telegram de cada usuario del CRM
alter table crm_users add column if not exists commission_rate numeric(5, 2) not null default 0;  -- %
alter table crm_users add column if not exists commission_base text not null default 'profit';  -- profit | sale
alter table crm_users add column if not exists telegram_id     text;

-- Tareas internas del equipo
create table if not exists staff_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  notes       text,
  assignee    text not null,                     -- correo
  due_date    date,
  customer_id uuid references customers(id) on delete set null,
  item_id     uuid references inventory_items(id) on delete set null,
  done_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists staff_tasks_open_idx on staff_tasks (assignee) where done_at is null;
alter table staff_tasks enable row level security;

-- Pagos con tarjeta (Stripe): depósitos para reservar y facturas
create table if not exists payments (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,               -- deposit | invoice
  item_id           uuid references inventory_items(id) on delete set null,
  document_id       uuid references documents(id) on delete set null,
  customer_id       uuid references customers(id) on delete set null,
  amount            numeric(12, 2) not null,
  status            text not null default 'open', -- open | paid | expired
  stripe_session_id text unique,
  url               text,
  created_by        text,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);
alter table payments enable row level security;
