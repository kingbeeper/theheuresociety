-- Publicación automática en Instagram de las ideas aprobadas.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-21-sourcing.sql
alter table content_ideas add column if not exists auto_publish    boolean not null default true; -- se publica sola a su hora
alter table content_ideas add column if not exists ig_container_id text;        -- contenedor creado en Instagram (video procesándose)
alter table content_ideas add column if not exists ig_media_id     text;        -- publicación ya hecha
alter table content_ideas add column if not exists permalink       text;
alter table content_ideas add column if not exists published_at    timestamptz;
alter table content_ideas add column if not exists publish_error   text;        -- último error (se borra al reintentar)

-- Cada 10 minutos Supabase llama a la web para publicar lo que toca (Vercel solo permite crons diarios).
-- ANTES de ejecutar este bloque, cambia PEGA_AQUI_CRON_SECRET por el valor de CRON_SECRET de tu .env.local
-- (queda guardado solo en tu base de datos; no subas este archivo con el valor puesto).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('ths-publish-due') where exists (select 1 from cron.job where jobname = 'ths-publish-due');
select cron.schedule(
  'ths-publish-due',
  '*/10 * * * *',
  $$ select net.http_get(
       url := 'https://theheuresociety.vercel.app/api/social/publish',
       headers := '{"Authorization": "Bearer PEGA_AQUI_CRON_SECRET"}'::jsonb,
       timeout_milliseconds := 290000
     ) $$
);
