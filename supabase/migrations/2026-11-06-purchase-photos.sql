-- Fotos como prueba del estado en que se recibió una pieza:
-- · inventory_items.photos: las fotos de entrada (p. ej. las que se mandan por Telegram al registrar una compra)
-- · documents.photos: copia fija en el contrato de compra (queda en el registro aunque cambie la ficha)
-- Las rutas privadas van con el prefijo «private:»
-- Ejecutar en Supabase > SQL Editor

alter table inventory_items add column if not exists photos text[] not null default '{}';
alter table documents add column if not exists photos text[] not null default '{}';
