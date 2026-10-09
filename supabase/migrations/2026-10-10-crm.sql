-- CRM: clientes y leads. Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-09-whatsapp.sql

-- Cada persona que muestra interés (por WhatsApp, la web, Instagram, en persona…)
create table if not exists customers (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  phone            text unique,                     -- formato +13055550123
  email            text unique,
  wa_id            text unique,                     -- número de WhatsApp sin "+"
  lang             text,
  source           text not null default 'other',   -- whatsapp | web_booking | web_sell | web_consign | web_alert | instagram | referral | walk_in | other
  stage            text not null default 'new',     -- new | contacted | qualified | appointment | negotiating | won | lost
  intent           text,                            -- buy | sell | consign | trade
  tags             text[] not null default '{}',
  interests        text,                            -- qué busca (marcas, modelos, referencias)
  budget           numeric(12, 2),
  notes            text,
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists customers_stage_idx on customers (stage, last_activity_at desc);

-- Historial de cada cliente: notas, cambios de etapa, citas, solicitudes, avisos…
create table if not exists customer_events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  type        text not null,
  body        text,
  meta        jsonb not null default '{}',
  created_by  text,                                 -- correo del usuario del CRM, o 'bot' / 'web'
  created_at  timestamptz not null default now()
);
create index if not exists customer_events_customer_idx on customer_events (customer_id, created_at desc);

-- «Avísenme cuando llegue…»: búsquedas de compradores. Al publicar un reloj que encaja, se avisa al equipo.
create table if not exists watch_alerts (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  query            text not null,
  active           boolean not null default true,
  last_notified_at timestamptz,
  created_at       timestamptz not null default now()
);

-- Enlaces con lo que ya existe
alter table wa_contacts   add column if not exists customer_id uuid references customers(id);
alter table appointments  add column if not exists customer_id uuid references customers(id);
alter table sell_requests add column if not exists customer_id uuid references customers(id);
alter table sell_requests add column if not exists status text not null default 'new'; -- new | offered | accepted | received | paid | rejected
alter table sell_requests add column if not exists offer_amount numeric(12, 2);
alter table sell_requests add column if not exists notes text;
alter table sell_requests add column if not exists updated_at timestamptz not null default now();

-- Solo el servidor accede (el CRM comprueba el usuario antes de leer o escribir)
alter table customers       enable row level security;
alter table customer_events enable row level security;
alter table watch_alerts    enable row level security;
