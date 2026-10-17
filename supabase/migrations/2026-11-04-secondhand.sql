-- Registro de compras de segunda mano (Florida, cap. 538): cada pieza comprada a un particular queda retenida
-- unos días antes de poder venderse, y el contrato de compra guarda los datos del vendedor que pide el registro.
-- Ejecutar en Supabase > SQL Editor

-- Fecha hasta la que la pieza no se puede vender (compras a particulares)
alter table inventory_items add column if not exists hold_until date;
-- Contrato de compra: dirección, descripción física y foto de la huella del vendedor (ruta privada)
alter table documents add column if not exists seller_details jsonb;
