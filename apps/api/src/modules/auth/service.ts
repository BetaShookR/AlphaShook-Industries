import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import type { LoginInput, PublicUser, RegisterInput, SessionInfo } from "@alphashook/shared";
import type { Database } from "../../db/client.js";
import { emailTokens, sessions, users } from "../../db/schema.js";
import { hashToken, newToken } from "../../lib/tokens.js";

// Parámetros Argon2id recomendados por OWASP (19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
  ) {
    super(code);
  }
}

type UserRow = typeof users.$inferSelect;
type Device = { deviceType: LoginInput["deviceType"]; deviceName?: string | undefined; ip?: string };

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  emailVerified: u.emailVerifiedAt !== null,
  createdAt: u.createdAt.toISOString(),
});

// Hash ficticio para igualar el tiempo de respuesta cuando el usuario no existe.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash("dummy-password-for-timing", ARGON));

export function createAuthService(db: Database) {
  async function createSession(userId: string, d: Device) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      deviceType: d.deviceType,
      deviceName: d.deviceName ?? null,
      ip: d.ip ?? null,
      expiresAt,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async function issueEmailToken(userId: string, type: "verify_email" | "reset_password") {
    // Invalida tokens previos del mismo tipo: solo el último enlace sirve.
    await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)));
    const token = newToken();
    const ttl = type === "verify_email" ? VERIFY_TTL_MS : RESET_TTL_MS;
    await db.insert(emailTokens).values({
      userId,
      type,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttl),
    });
    return token;
  }

  /** Marca el token como usado de forma atómica y devuelve su usuario, o null. */
  async function consumeEmailToken(token: string, type: "verify_email" | "reset_password") {
    const [row] = await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.tokenHash, hashToken(token)),
          eq(emailTokens.type, type),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: emailTokens.userId });
    return row?.userId ?? null;
  }

  return {
    async register(input: RegisterInput, d: Device) {
      const passwordHash = await hash(input.password, ARGON);
      let user: UserRow | undefined;
      try {
        [user] = await db
          .insert(users)
          .values({ username: input.username, email: input.email, passwordHash, termsAcceptedAt: new Date() })
          .returning();
      } catch (err) {
        // Drizzle envuelve el error de Postgres en `cause`.
        const pg = ((err as { cause?: unknown }).cause ?? err) as { constraint_name?: string };
        const c = pg.constraint_name;
        if (c === "users_username_lower_idx") throw new AuthError(409, "username_taken");
        if (c === "users_email_idx") throw new AuthError(409, "email_taken");
        throw err;
      }
      if (!user) throw new Error("insert sin resultado");
      const verifyToken = await issueEmailToken(user.id, "verify_email");
      const session = await createSession(user.id, d);
      return { ...session, user: toPublicUser(user), verifyToken };
    },

    async login(input: LoginInput, d: Device) {
      const id = input.identifier.toLowerCase();
      const [user] = await db
        .select()
        .from(users)
        .where(or(eq(users.email, id), eq(sql`lower(${users.username})`, id)))
        .limit(1);
      const ok = await verify(user?.passwordHash ?? (await getDummyHash()), input.password);
      if (!user || !ok) throw new AuthError(401, "invalid_credentials");
      if (user.status !== "active") throw new AuthError(403, "account_suspended");
      const session = await createSession(user.id, d);
      return { ...session, user: toPublicUser(user) };
    },

    /** Resuelve un token Bearer a su sesión y usuario activos. */
    async authenticate(token: string) {
      const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
        )
        .limit(1);
      if (!row || row.user.status !== "active") return null;
      // Actualiza lastUsedAt como máximo una vez por minuto para no escribir en cada request.
      if (Date.now() - row.session.lastUsedAt.getTime() > 60_000) {
        // Sesión deslizante: si se usa, se renueva (quien la use al menos una vez por mes no vuelve a iniciar sesión).
        const renew = row.session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2;
        await db.update(sessions)
          .set({ lastUsedAt: new Date(), ...(renew && { expiresAt: new Date(Date.now() + SESSION_TTL_MS) }) })
          .where(eq(sessions.id, row.session.id));
      }
      return row;
    },

    async listSessions(userId: string, currentId: string): Promise<SessionInfo[]> {
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
        .orderBy(sessions.lastUsedAt);
      return rows.map((s) => ({
        id: s.id,
        deviceType: s.deviceType,
        deviceName: s.deviceName,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.id === currentId,
      }));
    },

    async revokeSession(userId: string, sessionId: string) {
      const res = await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return res.length > 0;
    },

    async revokeOtherSessions(userId: string, keepId: string) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, userId), ne(sessions.id, keepId), isNull(sessions.revokedAt)));
    },

    async verifyEmail(token: string) {
      const userId = await consumeEmailToken(token, "verify_email");
      if (!userId) throw new AuthError(400, "invalid_or_expired_token");
      await db
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
    },

    async resendVerification(user: UserRow) {
      if (user.emailVerifiedAt) throw new AuthError(409, "already_verified");
      return issueEmailToken(user.id, "verify_email");
    },

    /** Devuelve el token si el correo existe; null si no (el caller no debe revelar cuál). */
    async requestPasswordReset(email: string) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      return user ? issueEmailToken(user.id, "reset_password") : null;
    },

    async resetPassword(token: string, password: string) {
      const userId = await consumeEmailToken(token, "reset_password");
      if (!userId) throw new AuthError(400, "invalid_or_expired_token");
      const passwordHash = await hash(password, ARGON);
      await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
      // Cambiar la contraseña cierra todas las sesiones abiertas.
      await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
