import { addShipmentAction, deleteShipmentAction, shipmentDeliveredAction } from "@/app/admin/document-actions";
import { CARRIERS, shipmentText, shipmentsFor, trackingUrl } from "@/lib/shipping";
import { emailReady } from "@/lib/email";
import type { Doc } from "@/lib/doc-labels";
import { Card, fieldClass, fmtDate, ghostButtonClass } from "@/components/admin/ui";

const small = "border px-2.5 py-1 text-[0.6rem] tracking-[0.16em] uppercase";

// 📦 Envíos del documento: rastreo con enlace a la paquetería y aviso al cliente al salir y al entregarse
export async function ShipmentCard({ d }: { d: Doc }) {
  const list = await shipmentsFor(d.id);
  const phone = d.client_phone?.replace(/\D/g, "");
  const canEmail = Boolean(d.client_email) && emailReady();
  return (
    <Card className="mt-6" title="📦 Envío">
      {list.length > 0 && (
        <ul className="mb-4 divide-y divide-line/60 text-sm">
          {list.map((s) => {
            const wa = (what: "shipped" | "delivered") => (phone ? `https://wa.me/${phone}?text=${encodeURIComponent(shipmentText(d, s, what))}` : null);
            const delivered = s.status === "delivered";
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p>
                    {CARRIERS[s.carrier] ?? s.carrier} ·{" "}
                    <a href={trackingUrl(s.carrier, s.tracking)} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">{s.tracking}</a>{" "}
                    <span className={`text-xs ${delivered ? "text-emerald-200" : "text-amber-200"}`}>· {delivered ? `Entregado ${s.delivered_at ? fmtDate(s.delivered_at) : ""}` : `En camino desde ${fmtDate(s.shipped_at)}`}</span>
                  </p>
                  <p className="text-xs text-stone">
                    {s.note ? `${s.note} · ` : ""}
                    {s.notified.length ? `Aviso por correo: ${s.notified.map((n) => (n === "shipped" ? "salida" : "entrega")).join(" y ")}` : "Sin aviso por correo"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {wa(delivered ? "delivered" : "shipped") && (
                    <a href={wa(delivered ? "delivered" : "shipped")!} target="_blank" rel="noreferrer" className={`${small} border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10`}>📲 Avisar por WhatsApp</a>
                  )}
                  {!delivered && (
                    <form action={shipmentDeliveredAction.bind(null, s.id)} className="flex items-center gap-1.5">
                      {canEmail && <input type="hidden" name="notify" value="1" />}
                      <button className={`${small} border-line text-stone hover:text-ivory`}>✅ Entregado{canEmail ? " (avisa por correo)" : ""}</button>
                    </form>
                  )}
                  <form action={deleteShipmentAction.bind(null, s.id)}>
                    <button className="text-xs text-stone/70 underline hover:text-red-200">Quitar</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form action={addShipmentAction.bind(null, d.id)} className="grid gap-3 sm:grid-cols-[150px_1fr_1fr_auto] sm:items-end">
        <select name="carrier" defaultValue="" className={fieldClass}>
          <option value="">Paquetería (auto)</option>
          {Object.entries(CARRIERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input name="tracking" required placeholder="Número de rastreo" className={fieldClass} />
        <input name="note" placeholder="Nota (asegurado, firma requerida…)" className={fieldClass} />
        <button className={ghostButtonClass}>Añadir envío</button>
        <label className="flex items-center gap-2 text-sm text-stone sm:col-span-4">
          <input type="checkbox" name="notify" value="1" defaultChecked={canEmail} disabled={!canEmail} className="h-4 w-4" />
          {canEmail ? `Avisar al cliente por correo (${d.client_email})` : d.client_email ? "El correo no está configurado: avísale por WhatsApp con el botón" : "El cliente no tiene correo: avísale por WhatsApp con el botón"}
        </label>
      </form>
    </Card>
  );
}
