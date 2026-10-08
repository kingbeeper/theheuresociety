-- Chatbot de WhatsApp: ejecutar una vez en Supabase > SQL Editor

-- Clientes que escriben por WhatsApp. `mode` = 'human' cuando el equipo atiende la conversación
-- (el bot no responde hasta `human_until` o hasta que se reactive desde Telegram).
create table if not exists wa_contacts (
  wa_id           text primary key,            -- número del cliente, formato internacional sin "+"
  name            text,
  lang            text,
  mode            text not null default 'bot', -- 'bot' | 'human'
  human_until     timestamptz,
  last_inbound_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Historial de cada conversación (contexto para el bot y registro para el equipo)
create table if not exists wa_messages (
  id          uuid primary key default gen_random_uuid(),
  wa_id       text not null references wa_contacts(wa_id) on delete cascade,
  wamid       text unique,                     -- id de WhatsApp: evita procesar un mensaje dos veces
  direction   text not null,                   -- 'in' (cliente) | 'bot' | 'staff' (equipo, desde la app)
  type        text not null,                   -- text, image, document, audio…
  body        text,
  media_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists wa_messages_contact_idx on wa_messages (wa_id, created_at desc);

-- Citas solicitadas (por ahora desde WhatsApp). Un horario solicitado o confirmado queda ocupado.
create table if not exists appointments (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('office', 'video')),
  starts_at   timestamptz not null,
  name        text not null,
  phone       text,
  email       text,
  pieces      text[] not null default '{}',    -- slugs de los relojes que quiere ver
  note        text,
  source      text not null default 'whatsapp',
  status      text not null default 'requested', -- requested | confirmed | cancelled
  created_at  timestamptz not null default now()
);
create unique index if not exists appointments_slot_taken
  on appointments (starts_at) where status in ('requested', 'confirmed');

-- Solo el servidor (clave secreta) accede a estas tablas
alter table wa_contacts  enable row level security;
alter table wa_messages  enable row level security;
alter table appointments enable row level security;

-- Conexión con WhatsApp (la guarda la página de conexión de Meta): token, id del número, etc.
create table if not exists wa_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table wa_settings enable row level security;
