// Da de alta (o cambia la contraseña de) un usuario del CRM.
//   node --env-file=.env.local scripts/crm-user.mjs
// La contraseña se escribe aquí y no se muestra en pantalla. Recuerda añadir el correo a
// CRM_ADMIN_EMAILS (en .env.local y en Vercel) para que pueda entrar.
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, hidden = false) =>
  new Promise((resolve) => {
    if (hidden) {
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (s) => write(s.includes(q) ? s : "*".repeat(s.length ? 1 : 0));
      rl.question(q, (a) => { rl._writeToOutput = write; process.stdout.write("\n"); resolve(a); });
    } else rl.question(q, resolve);
  });

const email = (await ask("Correo del usuario: ")).trim().toLowerCase();
const password = await ask("Contraseña (mínimo 10 caracteres): ", true);
rl.close();
if (!email.includes("@") || password.length < 10) {
  console.log("Correo no válido o contraseña demasiado corta.");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
const { error } = existing
  ? await db.auth.admin.updateUserById(existing.id, { password })
  : await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.log("Error:", error.message);
  process.exit(1);
}
const allowed = (process.env.CRM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
console.log(existing ? `Contraseña actualizada para ${email}.` : `Usuario ${email} creado.`);
if (!allowed.includes(email)) console.log(`Falta añadir ${email} a CRM_ADMIN_EMAILS en .env.local (y en Vercel con node scripts/vercel-env.mjs).`);
