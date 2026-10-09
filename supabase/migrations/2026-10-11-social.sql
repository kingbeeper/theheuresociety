-- Redes sociales (Instagram y Facebook) en el CRM. Ejecutar en Supabase > SQL Editor
-- DESPUÉS de 2026-10-10-crm.sql

-- Conexión con Meta (página, cuenta de Instagram, tokens) y ajustes de las redes
create table if not exists integration_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Publicaciones de Instagram y Facebook con sus métricas (se actualizan a diario)
create table if not exists social_posts (
  id                 text primary key,              -- id de la publicación en Meta
  platform           text not null,                 -- instagram | facebook
  media_type         text,                          -- IMAGE, VIDEO, CAROUSEL_ALBUM…
  product_type       text,                          -- FEED, REELS, STORY
  caption            text,
  permalink          text,
  thumbnail_url      text,
  posted_at          timestamptz,
  metrics            jsonb not null default '{}',   -- reach, views, likes, comments, saved, shares…
  metrics_updated_at timestamptz
);
create index if not exists social_posts_platform_idx on social_posts (platform, posted_at desc);

-- Evolución diaria de cada cuenta (seguidores, alcance, visualizaciones…)
create table if not exists social_daily (
  day      date not null,
  platform text not null,
  data     jsonb not null default '{}',
  primary key (day, platform)
);

-- Conversaciones por DM (Instagram) y Messenger (Facebook)
create table if not exists social_contacts (
  id              text primary key,                -- id del usuario en Instagram (IGSID) o Messenger (PSID)
  platform        text not null,                   -- instagram | facebook
  username        text,
  name            text,
  customer_id     uuid references customers(id),
  mode            text not null default 'bot',     -- bot | human
  human_until     timestamptz,
  last_inbound_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists social_messages (
  id          uuid primary key default gen_random_uuid(),
  contact_id  text not null references social_contacts(id) on delete cascade,
  mid         text unique,                         -- id del mensaje en Meta (evita duplicados)
  direction   text not null,                       -- in | bot | staff
  type        text not null,
  body        text,
  media_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists social_messages_contact_idx on social_messages (contact_id, created_at desc);

-- Comentarios en las publicaciones (los que muestran interés se convierten en leads)
create table if not exists social_comments (
  id            text primary key,                  -- id del comentario
  platform      text not null,
  post_id       text,
  from_id       text,
  from_username text,
  text          text,
  is_lead       boolean not null default false,
  customer_id   uuid references customers(id),
  replied_at    timestamptz,
  reply_text    text,
  created_at    timestamptz not null default now()
);
create index if not exists social_comments_post_idx on social_comments (post_id);

-- El cliente también se reconoce por su Instagram o su Messenger
alter table customers add column if not exists ig_id text unique;
alter table customers add column if not exists ig_username text;
alter table customers add column if not exists fb_psid text unique;

alter table integration_settings enable row level security;
alter table social_posts         enable row level security;
alter table social_daily         enable row level security;
alter table social_contacts      enable row level security;
alter table social_messages      enable row level security;
alter table social_comments      enable row level security;
