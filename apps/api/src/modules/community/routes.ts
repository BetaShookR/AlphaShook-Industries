import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z, type ZodTypeAny } from "zod";
import { moderateSchema, postInputSchema, profileInputSchema, reviewInputSchema, threadInputSchema } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import { CommunityError, createCommunityService } from "./service.js";

export interface CommunityRoutesOptions {
  db: Database;
  requireAuth: preHandlerHookHandler;
  optionalAuth: preHandlerHookHandler;
  writeLimitMax: number;
}

const slugRe = /^[a-z0-9-]{1,80}$/;
const usernameRe = /^[A-Za-z0-9_]{3,20}$/;
const uuidSchema = z.string().uuid();
const page = (max: number) => z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(max).default(max),
});

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new CommunityError(400, "validation_error") as CommunityError & { details?: unknown };
    err.details = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw err;
  }
  return r.data;
}
const check = (ok: boolean, code = "not_found") => {
  if (!ok) throw new CommunityError(404, code);
};
const uid = (req: FastifyRequest) => req.auth!.user.id;
const isMod = (req: FastifyRequest) => req.auth?.user.role === "moderator" || req.auth?.user.role === "admin";

export const communityRoutes: FastifyPluginAsync<CommunityRoutesOptions> = async (app, opts) => {
  const svc = createCommunityService(opts.db);
  const auth = { preHandler: opts.requireAuth };
  const optional = { preHandler: opts.optionalAuth };
  // Escrituras con límite por IP contra spam.
  const write = { preHandler: opts.requireAuth, config: { rateLimit: { max: opts.writeLimitMax, timeWindow: "1 minute" } } };
  const requireMod: preHandlerHookHandler = async (req, reply) => {
    if (!isMod(req)) return reply.code(403).send({ error: "forbidden" });
  };
  const mod = { preHandler: [opts.requireAuth, requireMod] };

  // ── Reseñas ──
  app.get<{ Params: { slug: string } }>("/products/:slug/reviews", optional, async (req) => {
    check(slugRe.test(req.params.slug));
    const q = parse(page(20), req.query);
    return svc.listReviews(req.params.slug, req.auth?.user.id ?? null, q.offset, q.limit);
  });
  app.put<{ Params: { slug: string } }>("/products/:slug/review", write, async (req, reply) => {
    check(slugRe.test(req.params.slug));
    const r = await svc.upsertReview(uid(req), req.params.slug, parse(reviewInputSchema, req.body));
    return reply.code(r.created ? 201 : 200).send({ id: r.id });
  });
  app.delete<{ Params: { slug: string } }>("/products/:slug/review", auth, async (req, reply) => {
    check(slugRe.test(req.params.slug));
    await svc.deleteReview(uid(req), req.params.slug);
    return reply.code(204).send();
  });

  // ── Perfiles ──
  app.get<{ Params: { username: string } }>("/users/:username", optional, async (req) => {
    check(usernameRe.test(req.params.username), "user_not_found");
    return svc.getProfile(req.params.username, req.auth?.user.id ?? null);
  });
  app.get("/me/profile", auth, async (req) => svc.getMyProfile(uid(req)));
  app.patch("/me/profile", write, async (req) => svc.updateProfile(uid(req), parse(profileInputSchema, req.body)));

  // ── Amigos ──
  app.get("/friends", auth, async (req) => svc.friends(uid(req)));
  app.post<{ Params: { username: string } }>("/friends/:username", write, async (req, reply) => {
    check(usernameRe.test(req.params.username), "user_not_found");
    const status = await svc.requestFriend(uid(req), req.params.username);
    return reply.code(status === "requested" ? 201 : 200).send({ status });
  });
  app.post<{ Params: { username: string } }>("/friends/:username/accept", auth, async (req) => {
    check(usernameRe.test(req.params.username), "user_not_found");
    await svc.acceptFriend(uid(req), req.params.username);
    return { status: "accepted" };
  });
  app.delete<{ Params: { username: string } }>("/friends/:username", auth, async (req, reply) => {
    check(usernameRe.test(req.params.username), "user_not_found");
    await svc.removeFriend(uid(req), req.params.username);
    return reply.code(204).send();
  });

  // ── Foros ──
  app.get("/forums", async () => svc.boards());
  app.get<{ Params: { board: string } }>("/forums/:board/threads", optional, async (req) => {
    check(slugRe.test(req.params.board));
    const q = parse(page(30), req.query);
    return svc.listThreads(req.params.board, isMod(req), q.offset, q.limit);
  });
  app.post("/forums/threads", write, async (req, reply) =>
    reply.code(201).send(await svc.createThread(uid(req), parse(threadInputSchema, req.body))),
  );
  app.get<{ Params: { id: string } }>("/forums/threads/:id", optional, async (req) => {
    check(uuidSchema.safeParse(req.params.id).success);
    const q = parse(page(50), req.query);
    return svc.getThread(req.params.id, isMod(req), q.offset, q.limit);
  });
  app.post<{ Params: { id: string } }>("/forums/threads/:id/posts", write, async (req, reply) => {
    check(uuidSchema.safeParse(req.params.id).success);
    const { body } = parse(postInputSchema, req.body);
    return reply.code(201).send(await svc.reply(uid(req), req.params.id, body, isMod(req)));
  });
  app.patch<{ Params: { id: string } }>("/forums/posts/:id", write, async (req, reply) => {
    check(uuidSchema.safeParse(req.params.id).success);
    await svc.editPost(uid(req), req.params.id, parse(postInputSchema, req.body).body);
    return reply.code(204).send();
  });

  // ── Moderación (rol moderator/admin) ──
  const hiddenOnly = z.object({ hidden: z.boolean() });
  app.patch<{ Params: { id: string } }>("/mod/reviews/:id", mod, async (req, reply) => {
    check(uuidSchema.safeParse(req.params.id).success);
    await svc.moderateReview(req.params.id, parse(hiddenOnly, req.body).hidden);
    return reply.code(204).send();
  });
  app.patch<{ Params: { id: string } }>("/mod/threads/:id", mod, async (req, reply) => {
    check(uuidSchema.safeParse(req.params.id).success);
    await svc.moderateThread(req.params.id, parse(moderateSchema, req.body));
    return reply.code(204).send();
  });
  app.patch<{ Params: { id: string } }>("/mod/posts/:id", mod, async (req, reply) => {
    check(uuidSchema.safeParse(req.params.id).success);
    await svc.moderatePost(req.params.id, parse(hiddenOnly, req.body).hidden);
    return reply.code(204).send();
  });
};
