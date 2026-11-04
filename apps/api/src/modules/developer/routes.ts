import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z, type ZodTypeAny } from "zod";
import { developerApplicationSchema, devProductCreateSchema, devProductSchema, reviewDecisionSchema } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import { createDeveloperService, DevError, type Actor } from "./service.js";

const slugRe = /^[a-z0-9-]{1,80}$/;

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new DevError(400, "validation_error") as DevError & { details?: unknown };
    err.details = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw err;
  }
  return r.data;
}
const actor = (req: FastifyRequest): Actor => ({ id: req.auth!.user.id, role: req.auth!.user.role });
const slugParam = (req: FastifyRequest<{ Params: { slug: string } }>) => {
  if (!slugRe.test(req.params.slug)) throw new DevError(404, "not_found");
  return req.params.slug;
};

export const developerRoutes: FastifyPluginAsync<{ db: Database; requireAuth: preHandlerHookHandler; writeLimitMax: number }> = async (app, opts) => {
  const svc = createDeveloperService(opts.db);
  app.addHook("preHandler", opts.requireAuth);
  const limited = { config: { rateLimit: { max: opts.writeLimitMax, timeWindow: "1 minute" } } };
  const adminOnly: preHandlerHookHandler = async (req, reply) => {
    if (req.auth?.user.role !== "admin") return reply.code(403).send({ error: "forbidden" });
  };
  const admin = { preHandler: adminOnly };

  // ── Solicitud para ser desarrollador ──
  app.get("/dev/status", async (req) => svc.portalStatus(actor(req)));
  app.post("/dev/application", limited, async (req, reply) =>
    reply.code(201).send(await svc.apply(actor(req), parse(developerApplicationSchema, req.body))),
  );

  // ── Productos del desarrollador ──
  app.get("/dev/orgs", async (req) => svc.orgs(actor(req)));
  app.get("/dev/products", async (req) => svc.listProducts(actor(req)));
  app.post("/dev/products", limited, async (req, reply) =>
    reply.code(201).send(await svc.createProduct(actor(req), parse(devProductCreateSchema, req.body))),
  );
  app.get<{ Params: { slug: string } }>("/dev/products/:slug", async (req) => svc.getProduct(actor(req), slugParam(req)));
  app.put<{ Params: { slug: string } }>("/dev/products/:slug", limited, async (req, reply) => {
    await svc.updateProduct(actor(req), slugParam(req), parse(devProductSchema, req.body));
    return reply.code(204).send();
  });
  for (const action of ["submit", "withdraw", "hide", "show"] as const) {
    app.post<{ Params: { slug: string } }>(`/dev/products/:slug/${action}`, async (req, reply) => {
      const a = actor(req), slug = slugParam(req);
      if (action === "submit") await svc.submit(a, slug);
      else if (action === "withdraw") await svc.withdraw(a, slug);
      else await svc.setVisibility(a, slug, action === "show");
      return reply.code(204).send();
    });
  }

  // ── Administración (rol admin) ──
  const statusQ = z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") });
  const idParam = (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw new DevError(404, "not_found");
    return req.params.id;
  };
  app.get("/admin/applications", admin, async (req) => svc.listApplications(parse(statusQ, req.query).status));
  app.post<{ Params: { id: string } }>("/admin/applications/:id/approve", admin, async (req) =>
    svc.approveApplication(actor(req), idParam(req), parse(reviewDecisionSchema, req.body ?? {}).note),
  );
  app.post<{ Params: { id: string } }>("/admin/applications/:id/reject", admin, async (req, reply) => {
    await svc.rejectApplication(actor(req), idParam(req), parse(reviewDecisionSchema, req.body ?? {}).note);
    return reply.code(204).send();
  });
  app.get("/admin/review", admin, async (req) => svc.reviewQueue(actor(req)));
  for (const action of ["approve", "reject"] as const) {
    app.post<{ Params: { slug: string } }>(`/admin/review/:slug/${action}`, admin, async (req, reply) => {
      await svc.decide(slugParam(req), action === "approve", parse(reviewDecisionSchema, req.body ?? {}).note);
      return reply.code(204).send();
    });
  }
};
