-- Seguimiento de cada cita: resultado (vino y compró, lo está pensando, no vino…), notas, llamadas
-- programadas y nuevas citas que salen de ella.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-23-serial-log.sql
alter table appointments add column if not exists outcome text;  -- bought | thinking | no_show | not_interested | other

create table if not exists appointment_followups (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  kind           text not null,             -- note | call | appointment | outcome
  body           text,
  due_at         date,                      -- llamada: día en que toca
  done_at        timestamptz,               -- llamada hecha
  new_appointment_id uuid references appointments(id) on delete set null,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists appointment_followups_appt_idx on appointment_followups (appointment_id, created_at);
create index if not exists appointment_followups_due_idx on appointment_followups (kind, due_at) where done_at is null;
alter table appointment_followups enable row level security;
