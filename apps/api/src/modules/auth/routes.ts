import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodType, ZodTypeDef } from "zod";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenBodySchema,
} from "@alphashook/shared";
import type { Mailer } from "../../lib/mailer.js";
import { AuthError, toPublicUser, type AuthService } from "./service.js";

type AuthCtx = NonNullable<Awaited<ReturnType<AuthService["authenticate"]>>>;

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthCtx;
  }
}

export const SESSION_COOKIE = "as_session";

export interface AuthRoutesOptions {
  secureCookies: boolean;
  auth: AuthService;
  mailer: Mailer;
  webUrl: string;
  rateLimitMax: number;
}

/** preHandler reutilizable: acepta Bearer (launcher/Android) o cookie (web). */
export function makeRequireAuth(auth: AuthService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : req.cookies[SESSION_COOKIE];
    const ctx = token ? await auth.authenticate(token) : null;
    if (!ctx) return reply.code(401).send({ error: "unauthorized" });
    req.auth = ctx;
  };
}

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new AuthError(400, "validation_error") as AuthError & { details?: unknown };
    err.details = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw err;
  }
  return r.data;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  const { auth, webUrl } = opts;
  // Un fallo del proveedor de correo no debe romper el registro ni filtrar si una cuenta existe.
  const mailer = {
    send: (m: Parameters<Mailer["send"]>[0]) => opts.mailer.send(m).catch((err) => app.log.error({ err }, "mail: envío fallido")),
  };
  const limited = { config: { rateLimit: { max: opts.rateLimitMax, timeWindow: "1 minute" } } };

  // Web: token en cookie httpOnly (no accesible desde JS). Launcher/Android: token en el body + header Bearer.
  const respondWithSession = (reply: FastifyReply, deviceType: string, res: { token: string; expiresAt: string }) => {
    if (deviceType !== "web") return res;
    reply.setCookie(SESSION_COOKIE, res.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: opts.secureCookies,
      path: "/",
      expires: new Date(res.expiresAt),
    });
    const { token: _t, ...rest } = res;
    return rest;
  };

  const requireAuth = makeRequireAuth(auth);

  const sendVerifyMail = (to: string, token: string) =>
    mailer.send({
      to,
      subject: "Verificá tu correo",
      text: `Confirmá tu cuenta: ${webUrl}/verify-email?token=${token}\nEl enlace vence en 24 horas.`,
    });

  app.post("/auth/register", limited, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const { verifyToken, ...res } = await auth.register(input, { ...input, ip: req.ip });
    await sendVerifyMail(res.user.email, verifyToken);
    return reply.code(201).send(respondWithSession(reply, input.deviceType, res));
  });

  app.post("/auth/login", limited, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    return respondWithSession(reply, input.deviceType, await auth.login(input, { ...input, ip: req.ip }));
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (req, reply) => {
    await auth.revokeSession(req.auth!.user.id, req.auth!.session.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (req) => toPublicUser(req.auth!.user));

  app.get("/auth/sessions", { preHandler: requireAuth }, async (req) =>
    auth.listSessions(req.auth!.user.id, req.auth!.session.id),
  );

  app.delete<{ Params: { id: string } }>("/auth/sessions/:id", { preHandler: requireAuth }, async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(404).send({ error: "not_found" });
    const ok = await auth.revokeSession(req.auth!.user.id, req.params.id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
  });

  app.post("/auth/sessions/revoke-others", { preHandler: requireAuth }, async (req, reply) => {
    await auth.revokeOtherSessions(req.auth!.user.id, req.auth!.session.id);
    return reply.code(204).send();
  });

  app.post("/auth/verify-email", limited, async (req, reply) => {
    await auth.verifyEmail(parse(tokenBodySchema, req.body).token);
    return reply.code(204).send();
  });

  app.post("/auth/verify-email/resend", { ...limited, preHandler: requireAuth }, async (req, reply) => {
    const token = await auth.resendVerification(req.auth!.user);
    await sendVerifyMail(req.auth!.user.email, token);
    return reply.code(204).send();
  });

  app.post("/auth/password/forgot", limited, async (req, reply) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const token = await auth.requestPasswordReset(email);
    if (token) {
      await mailer.send({
        to: email,
        subject: "Recuperación de contraseña",
        text: `Para elegir una nueva contraseña: ${webUrl}/reset-password?token=${token}\nEl enlace vence en 1 hora. Si no lo pediste, ignorá este correo.`,
      });
    }
    // Misma respuesta exista o no la cuenta, para no revelar correos registrados.
    return reply.code(202).send();
  });

  app.post("/auth/password/reset", limited, async (req, reply) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await auth.resetPassword(token, password);
    return reply.code(204).send();
  });
};
