-- Contratos de consignación (el cliente deja su reloj para que lo vendamos).
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-14-documents.sql
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('quote', 'memo', 'invoice', 'consignment'));
