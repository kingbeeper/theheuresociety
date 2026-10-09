-- Videos promocionales (Higgsfield → texto de la marca encima → Telegram).
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-18-ops.sql

create table if not exists promo_videos (
  id          uuid primary key default gen_random_uuid(),
  watch_id    uuid references watches(id) on delete cascade,
  chat_id     bigint,                              -- chat de Telegram al que se envía
  status      text not null default 'queued',      -- queued | rendering | done | failed
  request_id  text,
  status_url  text,
  input_url   text,                                -- foto preparada en vertical (9:16)
  raw_url     text,                                -- video de Higgsfield
  final_url   text,                                -- video final con el texto de la marca
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists promo_videos_watch_idx on promo_videos (watch_id, created_at desc);
alter table promo_videos enable row level security;
