-- Recordatorios de clientes (desde Telegram): qué quiere el cliente y cuándo darle seguimiento.
-- A su hora el bot avisa (la pasada de cada 10 minutos de pg_cron). Ejecutar DESPUÉS de 2026-10-26-proforma.sql
create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  body        text not null,                 -- lo que quiere el cliente / qué hay que hacer
  due_at      timestamptz not null,          -- cuándo avisar
  all_day     boolean not null default false, -- sin hora: avisa a las 9:00
  chat_id     bigint,                        -- chat de Telegram al que se avisa (además del resumen)
  notified_at timestamptz,
  done_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists reminders_due_idx on reminders (due_at) where done_at is null;
create index if not exists reminders_customer_idx on reminders (customer_id, due_at);
alter table reminders enable row level security;
