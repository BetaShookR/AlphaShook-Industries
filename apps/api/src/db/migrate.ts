import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { createDb } from "./client.js";

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

await migrate(db, { migrationsFolder });
console.log("Migraciones aplicadas.");
await sql.end();
