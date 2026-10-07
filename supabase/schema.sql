-- The Heure Society: esquema de base de datos (Supabase / Postgres)
-- Ejecutar en Supabase > SQL Editor.

create type watch_status as enum ('draft', 'available', 'reserved', 'sold');
create type watch_condition as enum ('new', 'unworn', 'excellent', 'very_good', 'good');

create table watches (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  status        watch_status not null default 'draft',

  -- Datos que confirma el cliente al publicar
  brand         text not null,
  model         text not null,
  reference     text not null,
  year          int,
  condition     watch_condition,
  has_box       boolean default false,
  has_papers    boolean default false,
  price         numeric(12, 2),
  currency      text not null default 'USD',

  -- Ficha técnica generada por IA (revisada por el cliente)
  specs         jsonb not null default '{}'::jsonb,  -- {case_size, case_material, movement, ...}

  -- Textos bilingües generados por IA
  title_en       text,
  title_es       text,
  description_en text,
  description_es text,

  featured      boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table watch_images (
  id         uuid primary key default gen_random_uuid(),
  watch_id   uuid not null references watches(id) on delete cascade,
  path       text not null,          -- ruta en Supabase Storage (bucket "watches")
  alt_en     text,
  alt_es     text,
  position   int not null default 0
);

-- Solicitudes de "Vende tu reloj"
create table sell_requests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone       text,
  brand       text,
  model       text,
  reference   text,
  message     text,
  image_paths text[] default '{}',
  created_at  timestamptz not null default now()
);

create index on watches (status, published_at desc);
create index on watch_images (watch_id, position);

-- Seguridad: el público solo lee relojes publicados; solo el admin escribe.
alter table watches       enable row level security;
alter table watch_images  enable row level security;
alter table sell_requests enable row level security;

create policy "public read published watches" on watches
  for select using (status in ('available', 'reserved', 'sold'));

create policy "public read images of published watches" on watch_images
  for select using (exists (
    select 1 from watches w
    where w.id = watch_id and w.status in ('available', 'reserved', 'sold')
  ));

create policy "public can submit sell requests" on sell_requests
  for insert with check (true);

create policy "admin full access watches" on watches
  for all to authenticated using (true) with check (true);
create policy "admin full access images" on watch_images
  for all to authenticated using (true) with check (true);
create policy "admin read sell requests" on sell_requests
  for select to authenticated using (true);
