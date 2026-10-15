-- Red de dealers: pedir una pieza (de un encargo, o una búsqueda suelta) a los dealers y anotar quién
-- respondió y con qué precio. Los dealers son los clientes con la etiqueta «Dealer».
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-29-return-receipts.sql
create table if not exists dealer_requests (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,   -- encargo del que sale (si lo hay)
  query       text not null,                                      -- qué se busca
  budget      numeric(12, 2),
  dealer_id   uuid not null references customers(id) on delete cascade,
  status      text not null default 'asked',                      -- asked | has | no | offered
  price       numeric(12, 2),                                     -- lo que pide el dealer
  note        text,
  asked_at    timestamptz not null default now(),
  answered_at timestamptz,
  created_by  text
);
create index if not exists dealer_requests_doc_idx on dealer_requests (document_id, asked_at);
create index if not exists dealer_requests_query_idx on dealer_requests (asked_at desc);
alter table dealer_requests enable row level security;
