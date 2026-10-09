// Permisos del CRM (servidor y navegador)

export const SECTIONS = {
  leads: "Leads y clientes",
  citas: "Citas",
  inventario: "Inventario",
  costos: "Ver costos, proveedores y márgenes",
  documentos: "Documentos (facturas, memos…)",
  compras: "Compras y consignas",
  demanda: "Demanda",
  informes: "Informes para el contador",
  correos: "Correos de novedades",
  redes: "Redes sociales",
  usuarios: "Usuarios y permisos",
} as const;
export type Section = keyof typeof SECTIONS;
export const ALL_SECTIONS = Object.keys(SECTIONS) as Section[];

export type Role = "owner" | "admin" | "staff";
export const ROLE_LABEL: Record<Role, string> = { owner: "Superadministrador", admin: "Administrador", staff: "Personalizado" };

// Plantillas para dar permisos rápido
export const PRESETS: Record<string, { label: string; role: Role; permissions: Section[] }> = {
  admin: { label: "Administrador (todo)", role: "admin", permissions: ALL_SECTIONS },
  seller: { label: "Vendedor", role: "staff", permissions: ["leads", "citas", "inventario", "documentos", "demanda"] },
  assistant: { label: "Asistente", role: "staff", permissions: ["leads", "citas"] },
  custom: { label: "Personalizado", role: "staff", permissions: [] },
};

export type CrmUser = { email: string; name: string | null; role: Role; permissions: Section[] };
export const can = (u: Pick<CrmUser, "role" | "permissions"> | null, s: Section) => Boolean(u && (u.role === "owner" || u.role === "admin" || u.permissions.includes(s)));
