import Fastify, { type FastifyBaseLogger, type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "./config/env.js";
import type { Database } from "./db/client.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { BrevoMailer, LogMailer, type Mailer } from "./lib/mailer.js";
import { authRoutes, makeOptionalAuth, makeRequireAuth } from "./modules/auth/routes.js";
import { communityRoutes } from "./modules/community/routes.js";
import { developerRoutes } from "./modules/developer/routes.js";
import { MemoryStorage, R2Storage, type ObjectStorage } from "./lib/storage.js";
import { releaseRoutes } from "./modules/releases/routes.js";
import { libraryRoutes } from "./modules/library/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { createAuthService } from "./modules/auth/service.js";
import { healthRoutes } from "./modules/health/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export interface AppDeps {
  mailer?: Mailer;
  /** null = sin almacenamiento. Por defecto se crea desde las variables R2_*. */
  storage?: ObjectStorage | null;
}

function createStorage(env: Env): ObjectStorage | null {
  if (!env.R2_ENDPOINT || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return new R2Storage({ endpoint: env.R2_ENDPOINT, bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
}
export { MemoryStorage };

function createMailer(env: Env, app: { log: FastifyBaseLogger }): Mailer {
  if (env.MAIL_PROVIDER === "brevo") {
    return new BrevoMailer(env.BREVO_API_KEY!, { email: env.MAIL_FROM_EMAIL!, name: env.MAIL_FROM_NAME }, app.log);
  }
  if (env.NODE_ENV === "production") app.log.warn("MAIL_PROVIDER=log en producción: los correos no se envían");
  return new LogMailer(app.log);
}

export function buildApp(env: Env, db: Database, deps: AppDeps = {}) {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL },
    trustProxy: env.NODE_ENV === "production",
    bodyLimit: 64 * 1024,
  });

  app.decorate("db", db);

  app.setErrorHandler((err: FastifyError & { code?: string; details?: unknown }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500 && status !== 503) {
      req.log.error({ err }, "error no controlado");
      return reply.code(500).send({ error: "internal_error" });
    }
    const body: Record<string, unknown> = { error: status === 429 ? "rate_limited" : (err.code ?? err.message) };
    if (err.details) body.details = err.details;
    return reply.code(status).send(body);
  });

  // global:false → solo aplica a rutas que declaran config.rateLimit.
  app.register(cookie);
  app.register(rateLimit, { global: false });

  app.register(healthRoutes);
  app.register(settingsRoutes, { prefix: "/v1" });
  const auth = createAuthService(db);
  app.register(authRoutes, {
    prefix: "/v1",
    auth,
    mailer: deps.mailer ?? createMailer(env, app),
    webUrl: env.PUBLIC_WEB_URL,
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    secureCookies: env.NODE_ENV === "production",
  });
  app.register(catalogRoutes, { prefix: "/v1", db });
  app.register(libraryRoutes, { prefix: "/v1", db, requireAuth: makeRequireAuth(auth) });
  app.register(communityRoutes, {
    prefix: "/v1",
    db,
    requireAuth: makeRequireAuth(auth),
    optionalAuth: makeOptionalAuth(auth),
    writeLimitMax: env.COMMUNITY_WRITE_LIMIT_MAX,
  });
  app.register(developerRoutes, { prefix: "/v1", db, requireAuth: makeRequireAuth(auth), writeLimitMax: env.COMMUNITY_WRITE_LIMIT_MAX });

  const storage = deps.storage !== undefined ? deps.storage : createStorage(env);
  if (!storage) app.log.warn("R2 no configurado: subida y descarga de archivos deshabilitadas");
  app.register(releaseRoutes, { prefix: "/v1", db, storage, requireAuth: makeRequireAuth(auth), writeLimitMax: env.COMMUNITY_WRITE_LIMIT_MAX });

  // Producción: la misma API sirve la tienda web (mismo origen → cookie de sesión sin CORS).
  const webDir = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null;
  if (webDir && existsSync(resolve(webDir, "index.html"))) {
    app.register(fastifyStatic, { root: webDir, wildcard: false, maxAge: "1h" });
    app.setNotFoundHandler((req, reply) => {
      // Rutas de la SPA → index.html; la API y archivos inexistentes siguen devolviendo 404 JSON.
      if (req.method === "GET" && !req.url.startsWith("/v1/") && !/\.[a-z0-9]+$/i.test(req.url.split("?")[0]!)) {
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  } else if (webDir) {
    app.log.warn({ webDir }, "WEB_DIST_DIR sin index.html: la tienda web no se sirve");
  }

  return app;
}
