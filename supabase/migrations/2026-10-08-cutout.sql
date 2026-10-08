-- Recorte automático para el estuche: ejecutar una vez en Supabase > SQL Editor
alter table watches add column if not exists cutout text;
