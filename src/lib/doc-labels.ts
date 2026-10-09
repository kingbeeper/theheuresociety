// Cotizaciones, memos y facturas: etiquetas y cálculos (servidor y navegador)

export type DocKind = "quote" | "memo" | "invoice" | "consignment";
export type DocStatus = "draft" | "sent" | "accepted" | "rejected" | "returned" | "paid" | "void" | "converted";

export type DocLine = {
  item_id?: string | null; // reloj del inventario (si lo es)
  sku?: string | null;
  title: string;
  details?: string | null; // referencia, año, caja y papeles…
  serial?: string | null;
  qty: number;
  price: number;
};

export type Doc = {
  id: string;
  kind: DocKind;
  number: string;
  status: DocStatus;
  customer_id: string | null;
  client_name: string | null;
  client_company: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  lang: "en" | "es";
  issue_date: string;
  due_date: string | null;
  items: DocLine[];
  discount: number;
  tax_rate: number;
  shipping: number;
  subtotal: number;
  total: number;
  show_serial: boolean;
  notes: string | null;
  terms: string | null;
  payment_method: string | null;
  paid_at: string | null;
  token: string;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
};

export const KIND_LABEL: Record<DocKind, string> = { quote: "Cotización", memo: "Memo", invoice: "Factura", consignment: "Consignación" };
export const KIND_PLURAL: Record<DocKind, string> = { quote: "Cotizaciones", memo: "Memos", invoice: "Facturas", consignment: "Consignaciones" };
export const KIND_PREFIX: Record<DocKind, string> = { quote: "Q", memo: "M", invoice: "INV", consignment: "C" };

// Estados posibles de cada tipo, con su etiqueta en el CRM
export const STATUS_LABEL: Record<DocKind, Partial<Record<DocStatus, string>>> = {
  quote: { draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada", converted: "Facturada", void: "Anulada" },
  memo: { draft: "Borrador", sent: "Reloj fuera", returned: "Devuelto", converted: "Facturado", void: "Anulado" },
  invoice: { draft: "Borrador", sent: "Por cobrar", paid: "Pagada", void: "Anulada" },
  // Contrato con quien nos deja su reloj: activo mientras lo tenemos; termina devuelto o pagado al dueño
  consignment: { draft: "Borrador", sent: "Activa", returned: "Devuelto al dueño", paid: "Pagada al dueño", void: "Anulada" },
};

export const STATUS_STYLE: Partial<Record<DocStatus, string>> = {
  draft: "text-stone",
  sent: "text-amber-200",
  accepted: "text-emerald-200",
  paid: "text-emerald-200",
  converted: "text-brass",
  returned: "text-stone",
  rejected: "text-stone/60",
  void: "text-stone/60",
};

const round = (n: number) => Math.round(n * 100) / 100;

export function docTotals(d: { items: DocLine[]; discount: number; tax_rate: number; shipping: number }) {
  const subtotal = round(d.items.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const discount = round(Math.min(Number(d.discount) || 0, subtotal));
  const tax = round((subtotal - discount) * ((Number(d.tax_rate) || 0) / 100));
  const shipping = round(Number(d.shipping) || 0);
  return { subtotal, discount, tax, shipping, total: round(subtotal - discount + tax + shipping) };
}

export const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Textos del documento impreso (lo que ve el cliente), en inglés o español
export const PRINT = {
  en: {
    quote: "Quotation", memo: "Memorandum", invoice: "Invoice", consignment: "Consignment Agreement",
    number: "No.", date: "Date", due: { quote: "Valid until", memo: "Return by", invoice: "Due date", consignment: "Term ends" },
    billTo: { quote: "Prepared for", memo: "Consignee", invoice: "Bill to", consignment: "Consignor" },
    item: "Description", serial: "Serial", qty: "Qty", price: "Price", amount: "Amount", net: "Net to consignor",
    consignSign: ["Consignor — signature", "The Heure Society — signature"],
    subtotal: "Subtotal", discount: "Discount", tax: "Sales tax", shipping: "Shipping & insurance", total: "Total",
    paid: "PAID", void: "VOID", payment: "Payment", notes: "Notes", terms: "Terms & conditions",
    signature: "Received in good condition — signature", print: "Print / Save as PDF",
    netTotal: "Total net to consignor",
  },
  es: {
    quote: "Cotización", memo: "Memorándum", invoice: "Factura", consignment: "Contrato de consignación",
    number: "N.º", date: "Fecha", due: { quote: "Válida hasta", memo: "Devolver antes de", invoice: "Vencimiento", consignment: "Vigente hasta" },
    billTo: { quote: "Preparada para", memo: "Recibe en memo", invoice: "Facturar a", consignment: "Consignante" },
    item: "Descripción", serial: "Serie", qty: "Cant.", price: "Precio", amount: "Importe", net: "Neto al consignante",
    consignSign: ["Consignante — firma", "The Heure Society — firma"],
    subtotal: "Subtotal", discount: "Descuento", tax: "Impuesto de ventas", shipping: "Envío y seguro", total: "Total",
    paid: "PAGADA", void: "ANULADA", payment: "Forma de pago", notes: "Notas", terms: "Términos y condiciones",
    signature: "Recibido en buen estado — firma", print: "Imprimir / Guardar PDF",
    netTotal: "Total neto al consignante",
  },
} as const;

// Ajustes del negocio que salen en los documentos (se editan en Documentos → Ajustes)
export const DOC_SETTING_KEYS = [
  "doc_company", "doc_address", "doc_phone", "doc_email", "doc_tax_id", "doc_payment_info", "doc_tax_rate",
  "doc_terms_quote", "doc_terms_memo", "doc_terms_invoice", "doc_terms_consignment",
] as const;
export type DocSettings = Partial<Record<(typeof DOC_SETTING_KEYS)[number], string>>;

// Valores iniciales. Revísalos (sobre todo los términos) con tu contador o abogado.
export const DOC_DEFAULTS: Required<DocSettings> = {
  doc_company: "The Heure Society",
  doc_address: "169 East Flagler St, Suite 1122\nMiami, FL 33131",
  doc_phone: "(305) 509-5767",
  doc_email: "",
  doc_tax_id: "",
  doc_payment_info: "",
  doc_tax_rate: "7",
  doc_terms_quote:
    "Prices are in US dollars and subject to availability until payment is received. This quotation is valid until the date shown. All timepieces are authenticated and sold as described.",
  doc_terms_memo:
    "The merchandise listed is delivered on memorandum only, for examination, and remains the property of The Heure Society until paid for in full. It is not sold or consigned for sale. The recipient is responsible for loss, theft or damage while in their possession and must return it, in the same condition, by the return date shown or upon request.",
  doc_terms_consignment:
    "The Consignor confirms they are the lawful owner of the timepiece(s) listed, free of any lien, and authorizes The Heure Society to offer them for sale during the term shown. Upon sale, The Heure Society will pay the Consignor the net amount shown within 5 business days of receiving cleared funds. The Heure Society may sell above the net amount and retains the difference. The timepiece(s) will be insured while in our care. If unsold at the end of the term, the Consignor may renew this agreement or collect the timepiece(s).",
  doc_terms_invoice:
    "Title passes to the buyer upon receipt of payment in full. All timepieces are authenticated and sold as described. All sales are final unless otherwise agreed in writing.",
};

// Los mismos términos en español, para documentos en español mientras no se hayan personalizado
const TERMS_ES: Record<DocKind, string> = {
  quote:
    "Precios en dólares estadounidenses, sujetos a disponibilidad hasta recibir el pago. Esta cotización es válida hasta la fecha indicada. Todos los relojes están autenticados y se venden tal como se describen.",
  memo:
    "La mercancía indicada se entrega únicamente en memorándum, para su examen, y sigue siendo propiedad de The Heure Society hasta su pago total. No se vende ni se entrega en consignación para la venta. Quien la recibe responde de su pérdida, robo o daño mientras esté en su poder y debe devolverla, en el mismo estado, antes de la fecha indicada o cuando se le solicite.",
  invoice:
    "La propiedad pasa al comprador al recibirse el pago total. Todos los relojes están autenticados y se venden tal como se describen. Todas las ventas son definitivas salvo acuerdo por escrito.",
  consignment:
    "El Consignante confirma que es el propietario legítimo del reloj o relojes indicados, libres de cargas, y autoriza a The Heure Society a ofrecerlos a la venta durante el plazo indicado. Al venderse, The Heure Society pagará al Consignante el importe neto indicado dentro de los 5 días hábiles siguientes a recibir los fondos. The Heure Society puede vender por encima del neto y se queda con la diferencia. El reloj estará asegurado mientras esté bajo nuestra custodia. Si no se vende al terminar el plazo, el Consignante puede renovar este acuerdo o retirar el reloj.",
};

export function termsFor(kind: DocKind, lang: "en" | "es", s: Required<DocSettings>) {
  const key = `doc_terms_${kind}` as const;
  const saved = s[key];
  return lang === "es" && saved === DOC_DEFAULTS[key] ? TERMS_ES[kind] : saved;
}
