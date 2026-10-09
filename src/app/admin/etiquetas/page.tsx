import { Suspense } from "react";
import QRCode from "qrcode";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { PrintLabels } from "./PrintLabels";

export const metadata = { title: "Etiquetas" };

// Etiquetas con código QR para imprimir: al escanearlas se abre la ficha del reloj en el CRM.
// Tamaño de etiqueta de dirección (2,625 × 1 in, 30 por hoja carta).
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");

export default function LabelsPage({ searchParams }: PageProps<"/admin/etiquetas">) {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <Labels searchParams={searchParams} />
    </Suspense>
  );
}

async function Labels({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireUser("inventario");
  const sp = await searchParams;
  const ids = typeof sp.ids === "string" ? sp.ids.split(",").filter(Boolean) : null;
  let q = adminDb().from("inventory_items").select("id, sku, brand, model, reference, serial").order("sku");
  q = ids ? q.in("id", ids) : q.in("status", ["in_stock", "reserved"]);
  const { data } = await q;
  const labels = await Promise.all(
    (data ?? []).map(async (i) => ({
      ...i,
      qr: await QRCode.toString(`${SITE}/admin/inventario/${i.id}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } }),
    }))
  );

  return (
    <main className="labels min-h-screen p-6 print:p-0">
      <style>{`
        html body{background:#e9e6df;color:#111}
        @page{size:letter;margin:0.5in 0.19in}
        @media print{html body{background:#fff}}
        .sheet{display:grid;grid-template-columns:repeat(3,2.625in);grid-auto-rows:1in;column-gap:0.125in}
        .label{display:flex;align-items:center;gap:0.1in;padding:0.08in 0.12in;background:#fff;overflow:hidden;font-family:var(--font-montserrat),sans-serif}
        .label svg{width:0.8in;height:0.8in;flex:none}
        @media screen{.label{outline:1px dashed #c9c2b3}}
      `}</style>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-[#333]">{labels.length} etiqueta(s) · hoja carta de 30 etiquetas (2,625 × 1 in, tipo Avery 5160)</p>
        <PrintLabels />
      </div>
      <div className="sheet">
        {labels.map((l) => (
          <div key={l.id} className="label">
            <span dangerouslySetInnerHTML={{ __html: l.qr }} />
            <div className="min-w-0 leading-tight">
              <p className="text-[13px] font-medium tracking-wide">{l.sku}</p>
              <p className="truncate text-[9px]">{l.brand} {l.model ?? ""}</p>
              <p className="truncate text-[9px] text-[#555]">{[l.reference, l.serial && `S/N ${l.serial}`].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
