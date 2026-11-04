import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { MemoryMailer } from "../src/lib/mailer.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000" });
const { db, sql } = createDb(env.DATABASE_URL);
const mailer = new MemoryMailer();
const app = buildApp(env, db, { mailer });

const sfx = Math.random().toString(36).slice(2, 8);
const user = { username: `Tester_${sfx}`, email: `tester_${sfx}@example.com`, password: "clave-segura-123" };
const reg = (over: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { ...user, passwordConfirm: user.password, acceptTerms: true, deviceType: "android", ...over },
  });
const login = (identifier: string, password = user.password, deviceType = "launcher") =>
  app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier, password, deviceType } });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const tokenFromMail = () => /token=([\w-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;

let webToken = "";

beforeAll(() => app.ready());
afterAll(async () => {
  await sql`delete from users where email like ${"%_" + sfx + "@example.com"}`;
  await app.close();
  await sql.end();
});

describe("registro", () => {
  it("crea la cuenta, devuelve sesión y envía verificación", async () => {
    const res = await reg();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ username: user.username, email: user.email, emailVerified: false });
    expect(body.user.passwordHash).toBeUndefined();
    expect(mailer.sent.at(-1)!.to).toBe(user.email);
    webToken = body.token;
  });

  it("guarda la contraseña con Argon2id", async () => {
    const [row] = await sql`select password_hash from users where email = ${user.email}`;
    expect(row!.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("rechaza username repetido sin distinguir mayúsculas", async () => {
    const res = await reg({ username: user.username.toUpperCase(), email: `otro_${sfx}@example.com` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("username_taken");
  });

  it("rechaza email repetido", async () => {
    const res = await reg({ username: `Otro_${sfx}`, email: user.email.toUpperCase() });
    expect(res.json().error).toBe("email_taken");
  });

  it("valida contraseñas distintas, términos y formato", async () => {
    expect((await reg({ passwordConfirm: "otra-cosa-123" })).statusCode).toBe(400);
    expect((await reg({ acceptTerms: false })).statusCode).toBe(400);
    const bad = await reg({ username: "a b", email: "no-es-email", password: "123" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details.length).toBeGreaterThanOrEqual(3);
  });
});

describe("login y sesiones", () => {
  it("acepta email o username, y rechaza credenciales inválidas", async () => {
    expect((await login(user.email)).statusCode).toBe(200);
    expect((await login(user.username.toLowerCase())).statusCode).toBe(200);
    const bad = await login(user.email, "incorrecta-123");
    expect(bad.statusCode).toBe(401);
    expect((await login("nadie_existe_xyz")).json().error).toBe("invalid_credentials");
  });

  it("GET /me requiere token válido", async () => {
    expect((await app.inject({ url: "/v1/me" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/me", headers: bearer("x".repeat(43)) })).statusCode).toBe(401);
    const me = await app.inject({ url: "/v1/me", headers: bearer(webToken) });
    expect(me.json().email).toBe(user.email);
  });

  it("lista sesiones por dispositivo y revoca otras", async () => {
    const list = (await app.inject({ url: "/v1/auth/sessions", headers: bearer(webToken) })).json();
    expect(list.length).toBe(3);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const launcherToken = (await login(user.email)).json().token;
    const r = await app.inject({ method: "POST", url: "/v1/auth/sessions/revoke-others", headers: bearer(webToken) });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ url: "/v1/me", headers: bearer(launcherToken) })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/auth/sessions", headers: bearer(webToken) })).json()).toHaveLength(1);
  });

  it("no permite revocar sesiones de otro usuario", async () => {
    const other = await reg({ username: `Ajeno_${sfx}`, email: `ajeno_${sfx}@example.com` });
    const [mine] = (await app.inject({ url: "/v1/auth/sessions", headers: bearer(webToken) })).json();
    const r = await app.inject({ method: "DELETE", url: `/v1/auth/sessions/${mine.id}`, headers: bearer(other.json().token) });
    expect(r.statusCode).toBe(404);
  });

  it("logout invalida el token", async () => {
    const t = (await login(user.email)).json().token;
    expect((await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(t) })).statusCode).toBe(204);
    expect((await app.inject({ url: "/v1/me", headers: bearer(t) })).statusCode).toBe(401);
  });
});

describe("sesión web por cookie", () => {
  it("login web no expone el token y usa cookie httpOnly", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: user.email, password: user.password, deviceType: "web" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().token).toBeUndefined();
    const c = r.cookies.find((x) => x.name === "as_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    const cookies = { as_session: c.value };
    expect((await app.inject({ url: "/v1/me", cookies })).json().email).toBe(user.email);
    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", cookies });
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ url: "/v1/me", cookies })).statusCode).toBe(401);
  });
});

describe("verificación de correo", () => {
  it("reenvío + verificación; el token es de un solo uso", async () => {
    await app.inject({ method: "POST", url: "/v1/auth/verify-email/resend", headers: bearer(webToken) });
    const token = tokenFromMail();
    expect((await app.inject({ method: "POST", url: "/v1/auth/verify-email", payload: { token } })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/v1/auth/verify-email", payload: { token } })).statusCode).toBe(400);
    expect((await app.inject({ url: "/v1/me", headers: bearer(webToken) })).json().emailVerified).toBe(true);
  });
});

describe("recuperación de contraseña", () => {
  it("misma respuesta para correos inexistentes", async () => {
    const before = mailer.sent.length;
    const r = await app.inject({ method: "POST", url: "/v1/auth/password/forgot", payload: { email: `x_${sfx}@example.com` } });
    expect(r.statusCode).toBe(202);
    expect(mailer.sent.length).toBe(before);
  });

  it("resetea la contraseña y cierra todas las sesiones", async () => {
    await app.inject({ method: "POST", url: "/v1/auth/password/forgot", payload: { email: user.email } });
    const token = tokenFromMail();
    const newPass = "nueva-clave-456";
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { token, password: newPass, passwordConfirm: newPass },
    });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ url: "/v1/me", headers: bearer(webToken) })).statusCode).toBe(401);
    expect((await login(user.email)).statusCode).toBe(401);
    expect((await login(user.email, newPass)).statusCode).toBe(200);
  });
});

describe("rate limiting", () => {
  it("bloquea intentos de login repetidos", async () => {
    const strict = buildApp(loadEnv({ ...process.env, NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "3" }), db, { mailer });
    await strict.ready();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await strict.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { identifier: "x", password: "y", deviceType: "web" },
      });
      codes.push(r.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429]);
    await strict.close();
  });
});
