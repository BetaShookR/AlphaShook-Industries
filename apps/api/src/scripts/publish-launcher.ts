/**
 * Sube la última versión del launcher a R2 para la actualización automática.
 * Uso: pnpm launcher:publish   (antes: crear el instalador con "npm run dist:win" en launcher/)
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { R2Storage } from "../lib/storage.js";

const release = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? "launcher/release");
const e = process.env;
if (!e.R2_ENDPOINT || !e.R2_BUCKET || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY) {
  console.error("✗ Falta configurar R2 (Panel → Ajustes → Configurar R2).");
  process.exit(1);
}
const s3 = new R2Storage({ endpoint: e.R2_ENDPOINT, bucket: e.R2_BUCKET, accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY });


const ymls = (await readdir(release).catch(() => [] as string[])).filter((f) => /^latest(-linux)?\.yml$/.test(f));
if (!ymls.length) {
  console.error(`✗ No hay latest.yml en ${release}. Primero creá el instalador.`);
  process.exit(1);
}
for (const name of ymls) {
  const yml = await readFile(resolve(release, name), "utf8");
  const version = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim();
  const file = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!version || !file) throw new Error(`${name} inválido`);
  // Primero el instalador (y su blockmap si existe); el .yml al final para no anunciar una versión a medio subir.
  for (const f of [file, `${file}.blockmap`]) {
    const data = await readFile(resolve(release, f)).catch(() => null);
    if (!data) continue;
    console.log(`Subiendo ${f} (${(data.length / 1024 ** 2).toFixed(1)} MB)…`);
    await s3.put(`launcher/${f}`, data, "application/octet-stream");
  }
  await s3.put(`launcher/${name}`, Buffer.from(yml), "text/yaml");
  console.log(`✓ Launcher v${version} publicado (${name === "latest.yml" ? "Windows" : "Linux"}).`);
}
console.log("Los launchers instalados se actualizan solos (al abrirlos o cada 4 horas).");
