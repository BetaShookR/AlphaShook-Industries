import type { FastifyPluginAsync } from "fastify";
import { catalogQuerySchema } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import { createCatalogService } from "./service.js";

export const catalogRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const catalog = createCatalogService(db);

  app.get("/home", async () => catalog.home());
  app.get("/categories", async () => catalog.categories());

  app.get("/products", async (req, reply) => {
    const q = catalogQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "validation_error" });
    return catalog.list(q.data);
  });

  app.get<{ Params: { slug: string } }>("/products/:slug", async (req, reply) => {
    if (!/^[a-z0-9-]{1,80}$/.test(req.params.slug)) return reply.code(404).send({ error: "not_found" });
    const p = await catalog.detail(req.params.slug);
    return p ?? reply.code(404).send({ error: "not_found" });
  });
};
