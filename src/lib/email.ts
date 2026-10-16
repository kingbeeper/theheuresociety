import "server-only";

// Correo transaccional con Resend (RESEND_API_KEY y EMAIL_FROM): avisos de envío y recordatorios de pago
export const emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plantilla sencilla con la marca: párrafos y un botón opcional
export function simpleEmail(paragraphs: string[], button?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Georgia,serif;color:#1d2a22">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e3ddd0">
      <tr><td style="background:#1d2a22;color:#f4f1ea;padding:22px 28px;font-size:13px;letter-spacing:4px;text-transform:uppercase">The Heure Society</td></tr>
      <tr><td style="padding:28px;font-size:15px;line-height:1.6">
        ${paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}
        ${button ? `<p style="margin:22px 0 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#1d2a22;color:#f4f1ea;padding:12px 22px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase">${esc(button.label)}</a></p>` : ""}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e3ddd0;font-size:12px;color:#7a7a70">The Heure Society · Miami · (305) 509-5767</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!emailReady()) throw new Error("Falta configurar el correo (RESEND_API_KEY y EMAIL_FROM)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
