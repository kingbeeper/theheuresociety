-- 1) Pedidos a dealers para un cliente concreto (su búsqueda): al responder «la tiene», aviso con el cliente
-- 2) Respuestas rápidas de WhatsApp (plantillas editables en español e inglés)
-- 3) Avisos en el móvil desde la app del CRM (suscripciones Web Push de cada dispositivo)
-- Ejecutar en Supabase > SQL Editor

alter table dealer_requests add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists dealer_requests_customer_idx on dealer_requests (customer_id);

create table if not exists message_templates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body_es    text not null,
  body_en    text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table message_templates enable row level security;

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_email text not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_email);
alter table push_subscriptions enable row level security;

-- Aviso «cita en una hora» enviado (una sola vez por cita)
alter table appointments add column if not exists push_notified_at timestamptz;
