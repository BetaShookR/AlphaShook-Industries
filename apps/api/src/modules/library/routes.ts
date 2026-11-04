import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { createLibraryService } from "./service.js";

const slugOk = (s: string) => /^[a-z0-9-]{1,80}$/.test(s);
const filtersSchema = z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(64).optional() });

export const libraryRoutes: FastifyPluginAsync<{ db: Database; requireAuth: preHandlerHookHandler }> = async (app, opts) => {
  const lib = createLibraryService(opts.db);
  app.addHook("preHandler", opts.requireAuth);
  const uid = (req: { auth?: { user: { id: string } } }) => req.auth!.user.id;

  app.get("/library", async (req, reply) => {
    const f = filtersSchema.safeParse(req.query);
    if (!f.success) return reply.code(400).send({ error: "validation_error" });
    return lib.list(uid(req), f.data);
  });

  app.post<{ Params: { slug: string } }>("/library/:slug", async (req, reply) => {
    if (!slugOk(req.params.slug)) return reply.code(404).send({ error: "not_found" });
    await lib.addFree(uid(req), req.params.slug);
    return reply.code(201).send({ ok: true });
  });

  app.get<{ Params: { slug: string } }>("/me/products/:slug", async (req, reply) => {
    if (!slugOk(req.params.slug)) return reply.code(404).send({ error: "not_found" });
    return lib.status(uid(req), req.params.slug);
  });

  app.get("/wishlist", async (req) => lib.wishlist(uid(req)));

  app.put<{ Params: { slug: string } }>("/wishlist/:slug", async (req, reply) => {
    if (!slugOk(req.params.slug)) return reply.code(404).send({ error: "not_found" });
    await lib.addWish(uid(req), req.params.slug);
    return reply.code(204).send();
  });

  app.delete<{ Params: { slug: string } }>("/wishlist/:slug", async (req, reply) => {
    if (!slugOk(req.params.slug)) return reply.code(404).send({ error: "not_found" });
    await lib.removeWish(uid(req), req.params.slug);
    return reply.code(204).send();
  });
};
