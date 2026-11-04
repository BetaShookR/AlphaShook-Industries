import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { desktopPlatformSchema, releaseCreateSchema } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import type { ObjectStorage } from "../../lib/storage.js";
import { DevError, type Actor } from "../developer/service.js";
import { createReleaseService } from "./service.js";

type P = { Params: { slug: string; id: string } };
const actor = (req: FastifyRequest): Actor => ({ id: req.auth!.user.id, role: req.auth!.user.role });
const params = (req: FastifyRequest<P>) => {
  if (!/^[a-z0-9-]{1,80}$/.test(req.params.slug)) throw new DevError(404, "not_found");
  if (req.params.id !== undefined && !z.string().uuid().safeParse(req.params.id).success) throw new DevError(404, "not_found");
  return req.params;
};
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new DevError(400, "validation_error") as DevError & { details?: unknown };
    err.details = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw err;
  }
  return r.data;
}

export const releaseRoutes: FastifyPluginAsync<{ db: Database; storage: ObjectStorage | null; requireAuth: preHandlerHookHandler; writeLimitMax: number }> = async (app, opts) => {
  const svc = createReleaseService(opts.db, opts.storage, app.log);
  app.addHook("preHandler", opts.requireAuth);
  const limited = { config: { rateLimit: { max: opts.writeLimitMax, timeWindow: "1 minute" } } };

  // ── Portal: versiones con archivo ──
  app.get<P>("/dev/products/:slug/releases", async (req) => svc.list(actor(req), params(req).slug));
  app.post<P>("/dev/products/:slug/releases", limited, async (req, reply) =>
    reply.code(201).send(await svc.create(actor(req), params(req).slug, parse(releaseCreateSchema, req.body) as never)),
  );
  app.post<P>("/dev/products/:slug/releases/:id/complete", async (req, reply) => {
    const { slug, id } = params(req);
    await svc.complete(actor(req), slug, id);
    return reply.code(202).send({ ok: true });
  });
  app.delete<P>("/dev/products/:slug/releases/:id", async (req, reply) => {
    const { slug, id } = params(req);
    await svc.remove(actor(req), slug, id);
    return reply.code(204).send();
  });

  // ── Launcher: descarga de la última versión ──
  const q = z.object({ platform: desktopPlatformSchema });
  app.get<P>("/library/:slug/download", async (req) =>
    svc.download(req.auth!.user.id, params(req).slug, parse(q, req.query).platform),
  );
};
