// Copia a Vercel (producción) las variables con valor de .env.local.
//   node scripts/vercel-env.mjs
// Los valores se pasan por la entrada estándar: no aparecen en pantalla ni en el historial.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SKIP = new Set(["VERCEL_OIDC_TOKEN"]);
// Las claves secretas se guardan como "Sensitive" (no se pueden volver a leer desde el panel)
const SECRET = /SECRET|TOKEN|_KEY$/;

const vars = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
  .filter(Boolean)
  .map(([, name, value]) => [name, value.trim().replace(/^"(.*)"$/, "$1")])
  .filter(([name, value]) => value && !SKIP.has(name));

if (!vars.length) {
  console.log("No hay variables con valor en .env.local");
  process.exit(0);
}

for (const [name, value] of vars) {
  const sensitive = SECRET.test(name) && !name.startsWith("NEXT_PUBLIC_");
  const args = ["env", "add", name, "production", "--force", "--yes", sensitive ? "--sensitive" : "--no-sensitive"];
  const res = spawnSync("vercel", args, { input: value, encoding: "utf8", shell: process.platform === "win32" });
  console.log(`${res.status === 0 ? "✓" : "✗"} ${name}${res.status === 0 ? "" : `\n${res.stderr || res.stdout}`}`);
}

console.log("\nListo. Las variables se aplican en la próxima publicación (git push o `vercel --prod`).");
