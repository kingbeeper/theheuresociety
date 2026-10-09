-- Usuarios del CRM con permisos. Ejecutar en Supabase > SQL Editor.
-- Los correos de CRM_ADMIN_EMAILS siguen siendo los superadministradores (no hace falta darlos de alta aquí).

create table if not exists crm_users (
  email        text primary key,                    -- en minúsculas
  name         text,
  role         text not null default 'staff',       -- admin (todo) | staff (solo sus permisos)
  permissions  text[] not null default '{}',        -- leads, citas, inventario, costos, documentos, compras, demanda, informes, correos, redes, usuarios
  active       boolean not null default true,
  invited_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table crm_users enable row level security;
