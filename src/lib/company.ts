// La empresa de un contacto va en sus notas como una línea «Empresa: …» (así la usan los dealers). Aquí se
// separa para editarla en su propio campo y se vuelve a unir al guardar.
export const companyOf = (notes: string | null | undefined) => notes?.match(/^Empresa: (.+)$/m)?.[1]?.trim() ?? null;
export const withoutCompany = (notes: string | null | undefined) => (notes ?? "").replace(/^Empresa: .*(\r?\n|$)/gm, "").trim();
export const joinCompany = (company: string | null | undefined, notes: string | null | undefined) => {
  const rest = (notes ?? "").trim();
  const c = company?.trim();
  return c ? (rest ? `Empresa: ${c}\n${rest}` : `Empresa: ${c}`) : rest || null;
};
