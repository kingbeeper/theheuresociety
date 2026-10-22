// Cotizaciones, memos y facturas: etiquetas y cálculos (servidor y navegador)

export type DocKind = "quote" | "memo" | "invoice" | "consignment" | "purchase" | "sourcing" | "proforma" | "return" | "inspection" | "service";
export type DocStatus = "draft" | "sent" | "accepted" | "rejected" | "returned" | "paid" | "void" | "converted";

export type DocLine = {
  item_id?: string | null; // reloj del inventario (si lo es)
  sku?: string | null;
  title: string;
  details?: string | null; // referencia, año, caja y papeles…
  serial?: string | null;
  qty: number;
  price: number;
  trade?: boolean; // reloj que entrega el cliente como parte del pago (importe negativo)
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
  last_reminder_at?: string | null;
  reminder_count?: number;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
  // Contrato de compra: identificación del vendedor (el número completo solo se ve en el CRM)
  seller_id_type?: string | null;
  seller_id_number?: string | null;
  seller_dob?: string | null;
  // Registro de compras de segunda mano: dirección, descripción física y huella del vendedor (solo en el CRM)
  seller_details?: SellerDetails | null;
  // Firma electrónica del cliente y foto de la identificación (archivos privados)
  signed_at?: string | null;
  signer_name?: string | null;
  signature_path?: string | null;
  signed_ip?: string | null;
  id_photo_path?: string | null;
  // Encargo: anticipo del cliente. En la factura que sale de un encargo, el anticipo que se descuenta
  deposit?: number;
  deposit_paid_at?: string | null;
  deposit_method?: string | null;
  refunded_at?: string | null;
  // Proforma: pagos a cuenta (depósitos)
  payments?: DocPayment[];
  // Acta de devolución: qué se devuelve (consignación o memo de dealer a su dueño, o un memo nuestro)
  return_of?: "consignment" | "memo" | null;
  // Ficha de inspección: estado del reloj al recibirlo (o entregarlo), con fotos privadas
  inspection?: Inspection | null;
  // Orden de servicio: pulido o reparación de una pieza del cliente
  service?: ServiceOrder | null;
};

// Orden de servicio: la pieza del cliente, el trabajo, el taller (joyero o relojero) y su costo, y el estado
export type ServiceStatus = "received" | "workshop" | "ready" | "delivered";
export type ServiceOrder = {
  status: ServiceStatus;
  piece: string; // «Cadena oro 14k amarillo, 20 in, cierre roto»
  provider: string | null; // taller al que va
  provider_cost: number | null; // lo que nos cobra el taller (para el margen)
  promised: string | null; // fecha prometida (AAAA-MM-DD)
  photos: string[]; // rutas privadas
  received_at: string | null;
  workshop_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  invoice_id: string | null;
};
export const SERVICE_STATUS: Record<ServiceStatus, string> = { received: "Recibida", workshop: "En el taller", ready: "Lista para entregar", delivered: "Entregada" };

// Ficha de inspección: cada parte del reloj con su estado, marcha, set y fotos
export type PartState = "ok" | "wear" | "damage" | "na";
export type Inspection = {
  direction: "in" | "out"; // «in»: lo recibimos de su dueño · «out»: lo entregamos
  parts: Partial<Record<InspectionPart, PartState>>;
  runs: boolean | null;
  rate: string | null; // marcha (s/día)
  power_reserve: string | null;
  links: string | null;
  box: boolean;
  papers: boolean;
  extras: string | null;
  notes: string | null;
  photos: string[]; // rutas en el almacenamiento privado
};
export const INSPECTION_PARTS = ["crystal", "bezel", "dial", "hands", "case", "caseback", "crown", "bracelet", "clasp"] as const;
export type InspectionPart = (typeof INSPECTION_PARTS)[number];
export const PART_LABEL: Record<"en" | "es", Record<InspectionPart, string>> = {
  en: { crystal: "Crystal", bezel: "Bezel", dial: "Dial", hands: "Hands", case: "Case", caseback: "Caseback", crown: "Crown / pushers", bracelet: "Bracelet / strap", clasp: "Clasp" },
  es: { crystal: "Cristal", bezel: "Bisel", dial: "Esfera", hands: "Agujas", case: "Caja", caseback: "Fondo", crown: "Corona / pulsadores", bracelet: "Brazalete / correa", clasp: "Cierre" },
};
export const STATE_LABEL: Record<"en" | "es", Record<PartState, string>> = {
  en: { ok: "Good", wear: "Signs of wear", damage: "Damage", na: "N/A" },
  es: { ok: "Bien", wear: "Marcas de uso", damage: "Daño", na: "No aplica" },
};
export type SellerDetails = { address: string | null; sex: string | null; race: string | null; height: string | null; weight: string | null; hair: string | null; eyes: string | null; thumb_path: string | null };
export type DocPayment = { date: string; amount: number; method: string | null };

export const SIGNABLE: DocKind[] = ["memo", "consignment", "purchase", "invoice", "quote", "sourcing", "proforma", "return", "inspection", "service"];

export const KIND_LABEL: Record<DocKind, string> = { quote: "Cotización", memo: "Memo", invoice: "Factura", consignment: "Consignación", purchase: "Contrato de compra", sourcing: "Encargo", proforma: "Proforma", return: "Acta de devolución", inspection: "Ficha de inspección", service: "Orden de servicio" };
export const KIND_PLURAL: Record<DocKind, string> = { quote: "Cotizaciones", memo: "Memos", invoice: "Facturas", consignment: "Consignaciones", purchase: "Compras", sourcing: "Encargos", proforma: "Proformas", return: "Devoluciones", inspection: "Inspecciones", service: "Servicios" };
export const KIND_PREFIX: Record<DocKind, string> = { quote: "Q", memo: "M", invoice: "INV", consignment: "C", purchase: "P", sourcing: "S", proforma: "PF", return: "R", inspection: "I", service: "SV" };

// Estados posibles de cada tipo, con su etiqueta en el CRM
export const STATUS_LABEL: Record<DocKind, Partial<Record<DocStatus, string>>> = {
  quote: { draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada", converted: "Facturada", void: "Anulada" },
  memo: { draft: "Borrador", sent: "Reloj fuera", returned: "Devuelto", converted: "Facturado", void: "Anulado" },
  invoice: { draft: "Borrador", sent: "Por cobrar", paid: "Pagada", void: "Anulada" },
  // Contrato con quien nos deja su reloj: activo mientras lo tenemos; termina devuelto o pagado al dueño
  consignment: { draft: "Borrador", sent: "Activa", returned: "Devuelto al dueño", paid: "Pagada al dueño", void: "Anulada" },
  // Contrato de compra (bill of sale): reloj que compramos a un particular o dealer
  purchase: { draft: "Borrador", sent: "Firmado", void: "Anulado" },
  // Encargo: buscando el reloj; termina conseguido (factura con el anticipo descontado) o con el anticipo devuelto
  sourcing: { draft: "Borrador", sent: "Buscando", converted: "Conseguido", returned: "Anticipo devuelto", void: "Anulado" },
  // Proforma: cotización aceptada; recibe depósitos y, saldada, pasa a factura pagada
  proforma: { draft: "Borrador", sent: "Abierta", converted: "Facturada", void: "Anulada" },
  // Acta de devolución: constancia firmada de que el reloj volvió a su dueño (o a nosotros)
  return: { draft: "Borrador", sent: "Emitida", void: "Anulada" },
  // Ficha de inspección: estado del reloj al recibirlo, firmada por su dueño
  inspection: { draft: "Borrador", sent: "Emitida", void: "Anulada" },
  // Orden de servicio: abierta mientras dura el trabajo; termina entregada (y facturada)
  service: { draft: "Borrador", sent: "En curso", converted: "Entregada", void: "Anulada" },
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
  n == null ? "—" : `${Number(n) < 0 ? "−" : ""}$${Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Textos del documento impreso (lo que ve el cliente), en inglés o español
export const PRINT = {
  en: {
    quote: "Quotation", memo: "Memorandum", invoice: "Invoice", consignment: "Consignment Agreement", purchase: "Bill of Sale", sourcing: "Sourcing Agreement", proforma: "Invoice", return: "Return Receipt", inspection: "Condition Report", service: "Repair Order",
    number: "No.", date: "Date", due: { quote: "Valid until", memo: "Return by", invoice: "Due date", consignment: "Term ends", purchase: "", sourcing: "Search period ends", proforma: "Balance due by", return: "", inspection: "", service: "Ready by" },
    billTo: { quote: "Prepared for", memo: "Consignee", invoice: "Bill to", consignment: "Consignor", purchase: "Seller", sourcing: "Client", proforma: "Bill to", return: "Returned to", inspection: "Owner", service: "Client" },
    returnedTo: "Returned to", returnedBy: "Returned by", returnRef: "Ref. agreement", conditionNote: "Condition and notes",
    returnSign: { consignment: ["Received by — signature", "The Heure Society — delivered by"], memo: ["Returned by — signature", "The Heure Society — received by"] },
    paymentsReceived: "Payments received", paymentLine: "Payment",
    sought: "Timepiece requested", upTo: "Agreed price (up to)", deposit: "Deposit", depositPaid: "Deposit received", depositDue: "Deposit due", depositRefunded: "Deposit refunded",
    lessDeposit: "Less deposit received", balance: "Balance due", balancePaid: "Balance paid",
    sourcingSign: ["Client — signature", "The Heure Society — signature"],
    purchaseSign: ["Seller — signature", "The Heure Society — signature"],
    paidTotal: "Total paid to seller", sellerId: "ID",
    item: "Description", serial: "Serial", qty: "Qty", price: "Price", amount: "Amount", net: "Net to consignor",
    consignSign: ["Consignor — signature", "The Heure Society — signature"],
    subtotal: "Subtotal", discount: "Discount", tax: "Sales tax", shipping: "Shipping & insurance", total: "Total",
    paid: "PAID IN FULL", void: "VOID", payment: "Payment", notes: "Notes", terms: "Terms & conditions",
    signature: "Received in good condition — signature", print: "Print / Save as PDF",
    netTotal: "Total net to consignor",
    signedBy: "Signed electronically by", acceptedBy: "Accepted and signed by",
    svc: { piece: "Item received", provider: "Workshop", status: "Status", sign: ["Client — signature", "The Heure Society — signature"], states: { received: "Received", workshop: "In the workshop", ready: "Ready for collection", delivered: "Delivered" } },
    insp: { title: "Condition on receipt", titleOut: "Condition on delivery", part: "Part", state: "Condition", runs: "Running", runsYes: "Yes", runsNo: "No", rate: "Rate (s/day)", power: "Power reserve", links: "Links", set: "Included", box: "Box", papers: "Papers", photos: "Photos", sign: ["Owner — signature", "The Heure Society — signature"] },
  },
  es: {
    quote: "Cotización", memo: "Memorándum", invoice: "Factura", consignment: "Contrato de consignación", purchase: "Contrato de compraventa", sourcing: "Acuerdo de búsqueda", proforma: "Factura", return: "Acta de devolución", inspection: "Ficha de inspección", service: "Orden de servicio",
    number: "N.º", date: "Fecha", due: { quote: "Válida hasta", memo: "Devolver antes de", invoice: "Vencimiento", consignment: "Vigente hasta", purchase: "", sourcing: "Plazo de búsqueda hasta", proforma: "Saldar antes de", return: "", inspection: "", service: "Lista para" },
    billTo: { quote: "Preparada para", memo: "Recibe en memo", invoice: "Facturar a", consignment: "Consignante", purchase: "Vendedor", sourcing: "Cliente", proforma: "Facturar a", return: "Devuelto a", inspection: "Dueño", service: "Cliente" },
    returnedTo: "Devuelto a", returnedBy: "Devuelto por", returnRef: "Contrato de referencia", conditionNote: "Estado y observaciones",
    returnSign: { consignment: ["Recibe — firma", "The Heure Society — entrega"], memo: ["Devuelve — firma", "The Heure Society — recibe"] },
    paymentsReceived: "Pagos recibidos", paymentLine: "Pago",
    sought: "Reloj solicitado", upTo: "Precio acordado (hasta)", deposit: "Anticipo", depositPaid: "Anticipo recibido", depositDue: "Anticipo pendiente", depositRefunded: "Anticipo devuelto",
    lessDeposit: "Menos anticipo recibido", balance: "Saldo pendiente", balancePaid: "Saldo pagado",
    sourcingSign: ["Cliente — firma", "The Heure Society — firma"],
    purchaseSign: ["Vendedor — firma", "The Heure Society — firma"],
    paidTotal: "Total pagado al vendedor", sellerId: "Identificación",
    item: "Descripción", serial: "Serie", qty: "Cant.", price: "Precio", amount: "Importe", net: "Neto al consignante",
    consignSign: ["Consignante — firma", "The Heure Society — firma"],
    subtotal: "Subtotal", discount: "Descuento", tax: "Impuesto de ventas", shipping: "Envío y seguro", total: "Total",
    paid: "PAGADA", void: "ANULADA", payment: "Forma de pago", notes: "Notas", terms: "Términos y condiciones",
    signature: "Recibido en buen estado — firma", print: "Imprimir / Guardar PDF",
    netTotal: "Total neto al consignante",
    signedBy: "Firmado electrónicamente por", acceptedBy: "Aceptado y firmado por",
    svc: { piece: "Pieza recibida", provider: "Taller", status: "Estado", sign: ["Cliente — firma", "The Heure Society — firma"], states: { received: "Recibida", workshop: "En el taller", ready: "Lista para recoger", delivered: "Entregada" } },
    insp: { title: "Estado al recibirlo", titleOut: "Estado al entregarlo", part: "Parte", state: "Estado", runs: "Funciona", runsYes: "Sí", runsNo: "No", rate: "Marcha (s/día)", power: "Reserva de marcha", links: "Eslabones", set: "Incluye", box: "Caja", papers: "Papeles", photos: "Fotos", sign: ["Dueño — firma", "The Heure Society — firma"] },
  },
} as const;

// Ajustes del negocio que salen en los documentos (se editan en Documentos → Ajustes)
export const DOC_SETTING_KEYS = [
  "doc_company", "doc_address", "doc_phone", "doc_email", "doc_tax_id", "doc_payment_info", "doc_tax_rate",
  "doc_terms_quote", "doc_terms_memo", "doc_terms_invoice", "doc_terms_consignment", "doc_terms_purchase", "doc_terms_sourcing", "doc_terms_proforma", "doc_terms_return", "doc_terms_inspection", "doc_terms_service", "doc_review_url",
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
  doc_review_url: "",
  doc_tax_rate: "7",
  doc_terms_quote:
    "Prices are in US dollars and subject to availability until payment is received. This quotation is valid until the date shown. All timepieces are authenticated and sold as described.",
  doc_terms_memo:
    "The merchandise listed is delivered on memorandum only, for examination, and remains the property of The Heure Society until paid for in full. It is not sold or consigned for sale. The recipient is responsible for loss, theft or damage while in their possession and must return it, in the same condition, by the return date shown or upon request.",
  doc_terms_consignment:
    "The Consignor confirms they are the lawful owner of the timepiece(s) listed, free of any lien, and authorizes The Heure Society to offer them for sale during the term shown. Upon sale, The Heure Society will pay the Consignor the net amount shown within 5 business days of receiving cleared funds. The Heure Society may sell above the net amount and retains the difference. The timepiece(s) will be insured while in our care. If unsold at the end of the term, the Consignor may renew this agreement or collect the timepiece(s).",
  doc_terms_purchase:
    "The Seller sells the timepiece(s) listed to The Heure Society for the total shown and confirms that they are the lawful owner; that the timepiece(s) are free of any lien, claim or encumbrance and have not been reported lost or stolen; and that, to the best of their knowledge, they are authentic and as described. The Seller will indemnify The Heure Society for any loss arising from a breach of these statements. Title passes to The Heure Society upon payment.",
  doc_terms_sourcing:
    "The Client asks The Heure Society to locate the timepiece described above, at a purchase price not exceeding the agreed price, within the search period shown. The deposit secures this request and will be credited in full toward the purchase price. When a timepiece matching the description is located, The Heure Society will notify the Client, who will have 3 business days to pay the balance. The deposit is fully refundable: if the timepiece is not located within the search period, or if the Client cancels this request, The Heure Society will refund the deposit in full within 5 business days. The search period may be extended by mutual agreement.",
  doc_terms_inspection:
    "The undersigned confirms that the timepiece described above was inspected in their presence and that its condition, functions and included items are as recorded in this report and the attached photographs. The Heure Society is not responsible for pre-existing wear or damage recorded here. This report does not constitute an appraisal or a certificate of authenticity.",
  doc_terms_service:
    "The Heure Society will carry out the work described above on the item received, in the condition recorded in this order and its photographs. Ready-by dates are estimates. The item will be insured while in our care. The client agrees to pay the amount shown on collection; items not collected within 60 days of the ready notice may incur storage fees. We are not responsible for pre-existing damage, loose stones or wear recorded here.",
  doc_terms_return:
    "The undersigned acknowledges the return of the timepiece(s) listed, in the condition described in this document. No amount is owed by either party for these timepieces.",
  doc_terms_proforma:
    "This proforma invoice confirms the sale of the timepiece(s) listed at the price shown. The timepiece(s) are reserved for the buyer from receipt of the deposit until the balance is paid by the date shown. Deposits are credited in full toward the purchase price. Title passes to the buyer, and a final invoice is issued, upon receipt of payment in full. All timepieces are authenticated and sold as described.",
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
  purchase:
    "El Vendedor vende a The Heure Society el reloj o relojes indicados por el total que figura y confirma que es su propietario legítimo; que están libres de cargas o reclamaciones y no han sido denunciados como perdidos o robados; y que, a su leal saber, son auténticos y tal como se describen. El Vendedor indemnizará a The Heure Society por cualquier perjuicio derivado del incumplimiento de estas declaraciones. La propiedad pasa a The Heure Society al realizarse el pago.",
  inspection:
    "El firmante confirma que el reloj descrito se revisó en su presencia y que su estado, funcionamiento y lo que incluye son los que constan en esta ficha y en las fotos adjuntas. The Heure Society no responde de las marcas de uso ni de los daños previos aquí registrados. Esta ficha no es una tasación ni un certificado de autenticidad.",
  service:
    "The Heure Society realizará el trabajo descrito sobre la pieza recibida, en el estado que consta en esta orden y sus fotos. Las fechas de entrega son aproximadas. La pieza estará asegurada mientras esté bajo nuestra custodia. El cliente pagará el importe indicado al recogerla; las piezas no recogidas en los 60 días siguientes al aviso de que están listas pueden generar gastos de custodia. No respondemos de los daños previos, piedras flojas o marcas de uso aquí registrados.",
  return:
    "El firmante deja constancia de la devolución del reloj o relojes indicados, en el estado descrito en este documento. Ninguna de las partes debe importe alguno por estos relojes.",
  proforma:
    "Esta factura proforma confirma la venta del reloj o relojes indicados al precio que figura. El reloj queda reservado para el comprador desde la recepción del depósito hasta el pago del saldo en la fecha indicada. Los depósitos se descuentan íntegramente del precio. La propiedad pasa al comprador, y se emite la factura final, al recibirse el pago total. Todos los relojes están autenticados y se venden tal como se describen.",
  sourcing:
    "El Cliente encarga a The Heure Society la búsqueda del reloj descrito, por un precio de compra que no supere el precio acordado, dentro del plazo de búsqueda indicado. El anticipo garantiza este encargo y se descontará íntegramente del precio de compra. Cuando se localice un reloj que cumpla la descripción, The Heure Society avisará al Cliente, que dispondrá de 3 días hábiles para pagar el saldo. El anticipo es totalmente reembolsable: si el reloj no se localiza dentro del plazo, o si el Cliente cancela el encargo, The Heure Society devolverá el anticipo íntegro en un máximo de 5 días hábiles. El plazo de búsqueda puede ampliarse de mutuo acuerdo.",
  consignment:
    "El Consignante confirma que es el propietario legítimo del reloj o relojes indicados, libres de cargas, y autoriza a The Heure Society a ofrecerlos a la venta durante el plazo indicado. Al venderse, The Heure Society pagará al Consignante el importe neto indicado dentro de los 5 días hábiles siguientes a recibir los fondos. The Heure Society puede vender por encima del neto y se queda con la diferencia. El reloj estará asegurado mientras esté bajo nuestra custodia. Si no se vende al terminar el plazo, el Consignante puede renovar este acuerdo o retirar el reloj.",
};

export function termsFor(kind: DocKind, lang: "en" | "es", s: Required<DocSettings>) {
  const key = `doc_terms_${kind}` as const;
  const saved = s[key];
  return lang === "es" && saved === DOC_DEFAULTS[key] ? TERMS_ES[kind] : saved;
}

// En el documento solo salen los 4 últimos caracteres del documento de identidad
export const maskedId = (d: Pick<Doc, "seller_id_type" | "seller_id_number">) =>
  d.seller_id_number ? `${d.seller_id_type ? `${d.seller_id_type} ` : ""}•••• ${d.seller_id_number.replace(/[^a-z0-9]/gi, "").slice(-4)}` : null;

export const ID_TYPES = ["Driver's license", "Passport", "State ID", "Otro"];

// Anticipo sugerido para un encargo según el precio del reloj (se puede cambiar en cada encargo).
// Cuanto más caro el reloj, menor el porcentaje; redondeado a 500 $.
export const DEPOSIT_TIERS: [upTo: number, pct: number][] = [
  [15_000, 20],
  [50_000, 15],
  [150_000, 10],
  [Infinity, 8],
];
export function suggestedDeposit(price: number) {
  if (!price || price <= 0) return 0;
  const pct = DEPOSIT_TIERS.find(([upTo]) => price <= upTo)![1];
  return Math.max(500, Math.round((price * pct) / 100 / 500) * 500);
}
export const depositPct = (price: number) => (price > 0 ? DEPOSIT_TIERS.find(([upTo]) => price <= upTo)![1] : 0);

// Lo que queda por pagar de una factura que sale de un encargo (total menos el anticipo ya recibido)
export const balanceDue = (d: Pick<Doc, "total" | "deposit">) => Math.max(0, Math.round((Number(d.total) - Number(d.deposit ?? 0)) * 100) / 100);

// Proforma: lo pagado a cuenta y lo que falta
export const paidSoFar = (d: Pick<Doc, "payments">) => Math.round((d.payments ?? []).reduce((a, p) => a + Number(p.amount || 0), 0) * 100) / 100;

// Texto del acta de devolución (en el idioma del documento)
export function returnTerms(of: "consignment" | "memo", lang: "en" | "es", ref: string | null) {
  if (of === "consignment")
    return lang === "es"
      ? `El firmante declara que ha recibido de The Heure Society el reloj o relojes indicados, en el mismo estado en que los entregó${ref ? `, y que queda terminado el contrato ${ref}` : ""}. Ninguna de las partes debe importe alguno por estos relojes.`
      : `The undersigned acknowledges receiving from The Heure Society the timepiece(s) listed, in the same condition as delivered${ref ? `, and that agreement ${ref} is terminated` : ""}. No amount is owed by either party for these timepieces.`;
  return lang === "es"
    ? `The Heure Society declara que ha recibido de vuelta el reloj o relojes indicados, entregados en memorándum${ref ? ` (${ref})` : ""}, en el estado descrito en este documento. Con esta devolución queda cerrado el memorándum para estos relojes.`
    : `The Heure Society acknowledges receiving back the timepiece(s) listed, delivered on memorandum${ref ? ` (${ref})` : ""}, in the condition described in this document. This return closes the memorandum for these timepieces.`;
}

// Encargo sin anticipo (solo búsqueda): términos sin depósito, en el idioma del documento
export const SOURCING_NO_DEPOSIT_TERMS = {
  en: "The Client asks The Heure Society to locate the timepiece described above, at a purchase price not exceeding the agreed price, within the search period shown. No deposit is required and neither party is obliged until a specific timepiece is offered and accepted. When a timepiece matching the description is located, The Heure Society will notify the Client, who may then confirm the purchase.",
  es: "El Cliente encarga a The Heure Society la búsqueda del reloj descrito, por un precio de compra que no supere el precio acordado, dentro del plazo de búsqueda indicado. No se pide anticipo y ninguna de las partes queda obligada hasta que se ofrezca y acepte un reloj concreto. Cuando se localice un reloj que cumpla la descripción, The Heure Society avisará al Cliente, que podrá confirmar la compra.",
} as const;

// Detalles de una línea en un documento en inglés: los datos de joyería se escriben en español en el CRM
// («Oro 18k amarillo · talla 7») y aquí se pasan al inglés («18k yellow gold · size 7»)
const COLORS: Record<string, string> = { amarillo: "yellow", blanco: "white", rosa: "rose", "dos tonos": "two-tone" };
const WORDS: [RegExp, string][] = [
  [/\bplata 925\b/gi, "sterling silver"], [/\bplatino\b/gi, "platinum"], [/\bacero\b/gi, "steel"],
  [/\bdiamante(s)?\b/gi, "diamond$1"], [/\besmeralda(s)?\b/gi, "emerald$1"], [/\bzafiro(s)?\b/gi, "sapphire$1"], [/\brub[ií](es)?\b/gi, "ruby"],
  [/\btalla\b/gi, "size"], [/\bcaja\b/gi, "box"], [/\bpapeles\b/gi, "papers"], [/\bestuche\b/gi, "case"], [/\bcertificado\b/gi, "certificate"],
];
export function localizeDetails(text: string | null | undefined, lang: "en" | "es") {
  if (!text || lang !== "en") return text ?? "";
  let out = text.replace(/\boro\s+(\d{1,2}\s*k)(?:\s+(amarillo|blanco|rosa|dos tonos))?/gi, (_m, k: string, c?: string) => `${k.replace(/\s/g, "")}${c ? ` ${COLORS[c.toLowerCase()]}` : ""} gold`);
  for (const [re, en] of WORDS) out = out.replace(re, en);
  return out.split(" · ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" · ");
}
