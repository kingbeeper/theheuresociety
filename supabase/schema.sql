-- The Heure Society: esquema de base de datos (Supabase / Postgres)
-- Ejecutar completo en Supabase > SQL Editor, y después supabase/seed.sql.

-- ─────────────────────────── Inventario ───────────────────────────
create type watch_status as enum ('draft', 'available', 'reserved', 'sold');

create table watches (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  status           watch_status not null default 'draft',

  brand            text not null,
  model            text not null,
  reference        text not null,
  year             int,
  has_box          boolean not null default false,
  has_papers       boolean not null default false,
  price            numeric(12, 2),            -- null = "Precio a consultar"
  currency         text not null default 'USD',
  case_size        text not null default '',

  -- Textos bilingües: {"en": "...", "es": "..."}
  material         jsonb not null default '{"en":"","es":""}',
  dial             jsonb,
  bracelet         jsonb,
  description      jsonb,

  movement         text,
  power_reserve    text,
  water_resistance text,

  -- Rutas locales (/watches/x.jpg) o URLs públicas de Supabase Storage, en orden
  images           text[] not null default '{}',
  -- Recorte 600×1200 para el estuche de la web (lo genera el robot al publicar)
  cutout           text,

  source           text not null default 'manual',  -- 'manual' | 'seed' | 'telegram'
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz
);

create index watches_status_published_idx on watches (status, published_at desc);

-- ─────────────────────── Solicitudes de clientes ───────────────────────
create table sell_requests (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'sell',   -- 'sell' | 'trade' | 'consign'
  name        text not null,
  email       text,
  phone       text,
  brand       text,
  model       text,
  reference   text,
  message     text,
  image_paths text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- ─────────────────────── Robot de Telegram ───────────────────────
-- Borrador de publicación: se crea al recibir fotos y se publica al confirmar.
create table bot_drafts (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  status      text not null default 'collecting',  -- collecting | analyzing | ready | published | cancelled
  caption     text,                                -- texto del administrador (modelo, precio, extras)
  data        jsonb,                               -- propuesta de la IA, editable
  awaiting    text,                                -- p. ej. 'price' cuando el bot espera un precio
  watch_id    uuid references watches(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Solo un borrador abierto por chat (evita duplicados cuando llega un álbum de fotos)
create unique index bot_drafts_one_open_per_chat
  on bot_drafts (chat_id) where status in ('collecting', 'analyzing', 'ready');

create table bot_draft_photos (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references bot_drafts(id) on delete cascade,
  path        text not null,           -- ruta dentro del bucket "watches"
  url         text not null,           -- URL pública
  tg_message  bigint not null,         -- id del mensaje de Telegram (orden de llegada)
  created_at  timestamptz not null default now(),
  unique (draft_id, tg_message)
);

-- ─────────────────────────── Seguridad ───────────────────────────
-- El público solo puede leer relojes publicados. Todo lo demás lo hace el
-- servidor con la clave secreta (que ignora estas reglas).
alter table watches          enable row level security;
alter table sell_requests    enable row level security;
alter table bot_drafts       enable row level security;
alter table bot_draft_photos enable row level security;

create policy "public read published watches" on watches
  for select using (status in ('available', 'reserved', 'sold'));

-- ─────────────────────────── Fotos ───────────────────────────
-- Bucket público para las fotos del inventario
insert into storage.buckets (id, name, public)
values ('watches', 'watches', true)
on conflict (id) do nothing;
