-- Redes: plan de contenido, calendario y comparación con la competencia.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-19-promo-videos.sql

-- Ideas de publicación (generadas por el CRM) y su calendario
create table if not exists content_ideas (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'suggested',   -- suggested | approved | posted | dismissed
  format        text not null,                       -- reel | carousel | post | story
  title         text not null,
  why           text,
  watch_id      uuid references watches(id) on delete set null,
  caption_es    text,
  caption_en    text,
  hashtags      text[] not null default '{}',
  visual_brief  text,
  scheduled_for timestamptz,                         -- día y hora recomendados (al aprobar queda en el calendario)
  reminded_at   timestamptz,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists content_ideas_status_idx on content_ideas (status, scheduled_for);
alter table content_ideas enable row level security;

-- Foto diaria de cuentas de la competencia (datos públicos de Instagram)
create table if not exists social_competitors (
  username   text not null,
  day        date not null,
  data       jsonb not null default '{}',
  primary key (username, day)
);
alter table social_competitors enable row level security;

-- Comentarios: respuesta sugerida y si ya respondimos desde la cuenta
alter table social_comments add column if not exists suggested_reply text;
alter table social_comments add column if not exists permalink text;
