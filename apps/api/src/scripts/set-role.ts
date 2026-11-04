/** Uso: pnpm user:role <usuario> <user|developer|moderator|admin> — hasta tener el panel admin (Etapa 9). */
import { sql as dsql } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { users } from "../db/schema.js";

const ROLES = ["user", "developer", "moderator", "admin"] as const;
const [username, role] = process.argv.slice(2);
if (!username || !ROLES.includes(role as (typeof ROLES)[number])) {
  console.error(`Uso: pnpm user:role <usuario> <${ROLES.join("|")}>`);
  process.exit(1);
}

const { db, sql } = createDb(loadEnv().DATABASE_URL);
try {
  const r = await db.update(users).set({ role: role as (typeof ROLES)[number], updatedAt: new Date() })
    .where(dsql`lower(${users.username}) = lower(${username})`)
    .returning({ username: users.username, role: users.role });
  if (!r.length) {
    console.error(`✗ No existe el usuario "${username}".`);
    process.exitCode = 1;
  } else console.log(`✓ ${r[0]!.username} ahora tiene el rol: ${r[0]!.role}`);
} finally {
  await sql.end();
}
