-- Gastos generales del negocio y precio de mercado semanal de cada reloj.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-27-reminders.sql

-- Gastos que no son de un reloj concreto (renta, marketing, envíos…): para la ganancia real del mes
create table if not exists business_expenses (
  id         uuid primary key default gen_random_uuid(),
  spent_on   date not null default current_date,
  category   text not null,          -- rent | marketing | shipping | commissions | software | travel | other
  amount     numeric(12, 2) not null,
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists business_expenses_date_idx on business_expenses (spent_on desc);
alter table business_expenses enable row level security;

-- Precio de mercado (Chrono24, WatchCharts…) revisado cada semana para los relojes en stock
alter table inventory_items add column if not exists market_low        numeric(12, 2);
alter table inventory_items add column if not exists market_typical    numeric(12, 2);
alter table inventory_items add column if not exists market_high       numeric(12, 2);
alter table inventory_items add column if not exists market_listings   integer;
alter table inventory_items add column if not exists market_note       text;
alter table inventory_items add column if not exists market_sources    jsonb not null default '[]';
alter table inventory_items add column if not exists market_checked_at timestamptz;
