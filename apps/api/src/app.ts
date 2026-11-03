import Fastify, { type FastifyError } from "fastify";
import type { Env } from "./config/env.js";
import type { Database } from "./db/client.js";
import { healthRoutes } from "./modules/health/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export function buildApp(env: Env, db: Database) {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL },
    trustProxy: env.NODE_ENV === "production",
  });

  app.decorate("db", db);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "error no controlado");
    reply.code(status).send({ error: status >= 500 ? "internal_error" : err.message });
  });

  app.register(healthRoutes);
  app.register(settingsRoutes, { prefix: "/v1" });

  return app;
}
