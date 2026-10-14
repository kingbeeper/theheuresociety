-- Historial de números de serie: cada vez que un serial entra (compra, consignación, memo, intercambio),
-- se vende, se devuelve o sale en un documento (memo, consignación, compra, factura, encargo), queda un
-- registro permanente. Así, si años después vuelve a entrar el mismo reloj, el sistema avisa.
-- Se rellena solo con disparadores (CRM, Telegram, importaciones) y nunca se borra.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 2026-10-22-ig-publish.sql

-- «7K3P-9921 » y «7k3p9921» son el mismo serial
create or replace function serial_norm(s text) returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(s, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create table if not exists serial_log (
  id          uuid primary key default gen_random_uuid(),
  serial_norm text not null,
  serial      text not null,                -- tal como se escribió
  event       text not null,                -- in_purchase | in_consignment | in_memo | in_trade | sold | returned | doc_memo | doc_consignment | doc_purchase | doc_invoice | doc_sourcing
  event_date  date not null default current_date,
  party       text,                         -- proveedor, dueño, comprador o cliente
  watch       text,                         -- marca, modelo y referencia
  item_id     uuid references inventory_items(id) on delete set null,
  sku         text,
  document_id uuid references documents(id) on delete set null,
  doc_number  text,
  ref_key     text not null,                -- evita registrar dos veces lo mismo
  created_at  timestamptz not null default now()
);
create unique index if not exists serial_log_ref_idx on serial_log (ref_key);
create index if not exists serial_log_serial_idx on serial_log (serial_norm, event_date);
alter table serial_log enable row level security;

-- Inventario: entrada (al crearse o al ponerle el serial), venta y devolución
create or replace function log_item_serial() returns trigger language plpgsql as $$
declare
  n text := serial_norm(new.serial);
  w text := concat_ws(' ', new.brand, new.model, new.reference);
begin
  if n is null then return new; end if;
  if tg_op = 'INSERT' or serial_norm(old.serial) is distinct from n then
    insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, ref_key)
    values (n, new.serial, 'in_' || coalesce(new.acquisition, 'purchase'), coalesce(new.purchase_date, current_date), new.supplier_name, w, new.id, new.sku, 'item:' || new.id || ':in:' || n)
    on conflict (ref_key) do nothing;
  end if;
  if new.status = 'sold' and (tg_op = 'INSERT' or old.status is distinct from 'sold' or serial_norm(old.serial) is distinct from n) then
    insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, ref_key)
    values (n, new.serial, 'sold', coalesce(new.sale_date, current_date), new.buyer_name, w, new.id, new.sku, 'item:' || new.id || ':sold:' || n)
    on conflict (ref_key) do nothing;
  end if;
  if new.status = 'returned' and (tg_op = 'INSERT' or old.status is distinct from 'returned' or serial_norm(old.serial) is distinct from n) then
    insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, ref_key)
    values (n, new.serial, 'returned', coalesce(new.return_date, current_date), new.supplier_name, w, new.id, new.sku, 'item:' || new.id || ':returned:' || n)
    on conflict (ref_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists inventory_items_serial_log on inventory_items;
create trigger inventory_items_serial_log after insert or update on inventory_items for each row execute function log_item_serial();

-- Documentos: cada línea con serial, cuando el documento deja de ser borrador (las cotizaciones no cuentan)
create or replace function log_doc_serials() returns trigger language plpgsql as $$
declare
  line jsonb;
  n text;
begin
  if new.kind = 'quote' or new.status = 'draft' then return new; end if;
  for line in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    n := serial_norm(line->>'serial');
    if n is not null then
      insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, document_id, doc_number, ref_key)
      values (n, line->>'serial', 'doc_' || new.kind, coalesce(new.issue_date, current_date), new.client_name, line->>'title',
              nullif(line->>'item_id', '')::uuid, line->>'sku', new.id, new.number, 'doc:' || new.id || ':' || n)
      on conflict (ref_key) do nothing;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists documents_serial_log on documents;
create trigger documents_serial_log after insert or update on documents for each row execute function log_doc_serials();

-- Lo que ya había en el sistema
insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, ref_key)
select serial_norm(serial), serial, 'in_' || coalesce(acquisition, 'purchase'), coalesce(purchase_date, created_at::date), supplier_name,
       concat_ws(' ', brand, model, reference), id, sku, 'item:' || id || ':in:' || serial_norm(serial)
from inventory_items where serial_norm(serial) is not null
on conflict (ref_key) do nothing;

insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, ref_key)
select serial_norm(serial), serial, 'sold', coalesce(sale_date, current_date), buyer_name, concat_ws(' ', brand, model, reference), id, sku, 'item:' || id || ':sold:' || serial_norm(serial)
from inventory_items where serial_norm(serial) is not null and status = 'sold'
on conflict (ref_key) do nothing;

insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, ref_key)
select serial_norm(serial), serial, 'returned', coalesce(return_date, current_date), supplier_name, concat_ws(' ', brand, model, reference), id, sku, 'item:' || id || ':returned:' || serial_norm(serial)
from inventory_items where serial_norm(serial) is not null and status = 'returned'
on conflict (ref_key) do nothing;

insert into serial_log (serial_norm, serial, event, event_date, party, watch, item_id, sku, document_id, doc_number, ref_key)
select serial_norm(l->>'serial'), l->>'serial', 'doc_' || d.kind, d.issue_date, d.client_name, l->>'title', nullif(l->>'item_id', '')::uuid, l->>'sku', d.id, d.number,
       'doc:' || d.id || ':' || serial_norm(l->>'serial')
from documents d, jsonb_array_elements(d.items) l
where d.kind <> 'quote' and d.status <> 'draft' and serial_norm(l->>'serial') is not null
on conflict (ref_key) do nothing;
