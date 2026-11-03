import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const app = buildApp(env, db);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "cerrando");
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.PORT, host: env.HOST });
