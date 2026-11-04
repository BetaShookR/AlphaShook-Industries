/** Uso: pnpm catalog:import <archivo.json> — herramienta de administración hasta tener el portal. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { importProducts } from "../modules/catalog/import.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: pnpm catalog:import <archivo.json>");
  process.exit(1);
}

const { db, sql } = createDb(loadEnv().DATABASE_URL);
try {
  const data = JSON.parse(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8"));
  for (const r of await importProducts(db, data)) console.log(`${r.action === "created" ? "Creado" : "Actualizado"}: ${r.slug}`);
} catch (err) {
  if (err instanceof ZodError) {
    for (const i of err.issues) console.error(`✗ ${i.path.join(".")}: ${i.message}`);
  } else console.error("✗", (err as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
