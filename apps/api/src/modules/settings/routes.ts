import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { storeIdentitySchema } from "@alphashook/shared";
import { settings } from "../../db/schema.js";

export const STORE_IDENTITY_KEY = "store.identity";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  /** Identidad pública de la tienda (nombre, logo). Configurable desde la BD. */
  app.get("/store/identity", async (_req, reply) => {
    const [row] = await app.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, STORE_IDENTITY_KEY))
      .limit(1);
    const parsed = storeIdentitySchema.safeParse(row?.value);
    if (!parsed.success) {
      app.log.error("settings: store.identity ausente o inválido");
      return reply.code(500).send({ error: "store_identity_not_configured" });
    }
    return parsed.data;
  });
};
