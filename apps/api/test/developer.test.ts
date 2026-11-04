import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { MemoryMailer } from "../src/lib/mailer.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000", COMMUNITY_WRITE_LIMIT_MAX: "1000" });
const { db, sql } = createDb(env.DATABASE_URL);
const app = buildApp(env, db, { mailer: new MemoryMailer() });
const sfx = Math.random().toString(36).slice(2, 8);
const name = (n: string) => `D${n}_${sfx}`;
const studio = `Estudio Ñandú ${sfx}`;
const slug = `dev-juego-${sfx}`;
const tok: Record<string, string> = {};
type M = "GET" | "POST" | "PUT";
const call = (who: string | null, method: M, url: string, payload?: unknown) =>
  app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }), headers: who ? { authorization: `Bearer ${tok[who]}` } : {} });

const product = {
  name: "Juego del estudio", shortDescription: "Un juego de prueba del portal", description: "Descripción larga del juego de prueba para el portal.",
  priceCents: 0, platforms: ["windows"], categories: ["indie"], tags: ["Pixel Art", "pixel art"],
  media: ["https://example.com/a.png"], coverUrl: "",
  requirements: [
    { platform: "windows", level: "minimum", specs: { os: "Windows 10", ram: "4 GB" } },
    { platform: "linux", level: "minimum", specs: { os: "Ubuntu" } }, // plataforma no elegida: se descarta
  ],
};

beforeAll(async () => {
  await app.ready();
  for (const n of ["dev", "admin", "otro"]) {
    const r = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
      username: name(n), email: `d${n}_${sfx}@example.com`, password: "clave-segura-1", passwordConfirm: "clave-segura-1", acceptTerms: true, deviceType: "launcher" } });
    tok[n] = r.json().token;
  }
  await sql`update users set role = 'admin' where username = ${name("admin")}`;
});

afterAll(async () => {
  await sql`delete from users where email like ${"%_" + sfx + "@example.com"}`;
  await sql`delete from products where slug = ${slug}`;
  await sql`delete from organizations where name = ${studio}`;
  await app.close();
  await sql.end();
});

describe("solicitud de desarrollador", () => {
  let appId = "";
  it("valida, crea una sola pendiente y solo el admin la ve", async () => {
    expect((await call("dev", "POST", "/v1/dev/application", { studioName: "X", about: "corto" })).statusCode).toBe(400);
    expect((await call("dev", "POST", "/v1/dev/application", { studioName: studio, about: "Hacemos juegos indie desde hace años.", website: "" })).statusCode).toBe(201);
    expect((await call("dev", "POST", "/v1/dev/application", { studioName: studio, about: "Hacemos juegos indie desde hace años." })).json().error).toBe("application_pending");
    expect((await call("dev", "GET", "/v1/dev/status")).json().application.status).toBe("pending");
    expect((await call("dev", "GET", "/v1/admin/applications")).statusCode).toBe(403);
    const list = (await call("admin", "GET", "/v1/admin/applications")).json();
    appId = list.find((a: { studioName: string }) => a.studioName === studio).id;
    expect(appId).toBeTruthy();
  });

  it("sin estudio no puede crear productos", async () => {
    expect((await call("dev", "POST", "/v1/dev/products", { ...product, slug, org: "lo-que-sea" })).json().error).toBe("not_org_member");
  });

  it("el admin aprueba: crea el estudio y da rol developer", async () => {
    const r = await call("admin", "POST", `/v1/admin/applications/${appId}/approve`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().org).toBe(`estudio-nandu-${sfx}`);
    expect((await call("dev", "GET", "/v1/me")).json().role).toBe("developer");
    const st = (await call("dev", "GET", "/v1/dev/status")).json();
    expect(st.orgs).toEqual([{ slug: `estudio-nandu-${sfx}`, name: studio, role: "owner" }]);
    expect((await call("admin", "POST", `/v1/admin/applications/${appId}/approve`, {})).statusCode).toBe(404);
    expect((await call("dev", "POST", "/v1/dev/application", { studioName: "Otro", about: "Hacemos juegos indie desde hace años." })).json().error).toBe("already_developer");
  });
});

describe("productos y revisión", () => {
  const org = () => `estudio-nandu-${sfx}`;

  it("crea un borrador que no aparece en la tienda", async () => {
    expect((await call("dev", "POST", "/v1/dev/products", { ...product, slug, org: org(), categories: ["no-existe"] })).json().error).toBe("invalid_category");
    expect((await call("dev", "POST", "/v1/dev/products", { ...product, slug, org: org() })).statusCode).toBe(201);
    expect((await call("dev", "POST", "/v1/dev/products", { ...product, slug, org: org() })).json().error).toBe("slug_taken");
    expect((await call(null, "GET", `/v1/products/${slug}`)).statusCode).toBe(404);
    const d = (await call("dev", "GET", `/v1/dev/products/${slug}`)).json();
    expect(d.status).toBe("draft");
    expect(d.tags).toEqual(["Pixel Art"]);
    expect(d.requirements).toHaveLength(1);
    expect((await call("otro", "GET", `/v1/dev/products/${slug}`)).statusCode).toBe(404);
    expect((await call("otro", "PUT", `/v1/dev/products/${slug}`, product)).statusCode).toBe(404);
  });

  it("enviar, rechazar con motivo, corregir y aprobar", async () => {
    expect((await call("dev", "POST", `/v1/dev/products/${slug}/submit`)).statusCode).toBe(204);
    expect((await call("dev", "PUT", `/v1/dev/products/${slug}`, product)).json().error).toBe("in_review_locked");
    const q = (await call("admin", "GET", "/v1/admin/review")).json();
    expect(q.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    expect((await call("dev", "POST", `/v1/admin/review/${slug}/approve`)).statusCode).toBe(403);
    expect((await call("admin", "POST", `/v1/admin/review/${slug}/reject`, { note: "Falta portada" })).statusCode).toBe(204);
    let row = (await call("dev", "GET", "/v1/dev/products")).json()[0];
    expect(row).toMatchObject({ slug, status: "draft", reviewNote: "Falta portada" });
    expect((await call("dev", "PUT", `/v1/dev/products/${slug}`, { ...product, coverUrl: "https://example.com/c.png" })).statusCode).toBe(204);
    await call("dev", "POST", `/v1/dev/products/${slug}/submit`);
    expect((await call("admin", "POST", `/v1/admin/review/${slug}/approve`)).statusCode).toBe(204);
    const pub = (await call(null, "GET", `/v1/products/${slug}`)).json();
    expect(pub.coverUrl).toBe("https://example.com/c.png");
    expect(pub.developer.name).toBe(studio);
    row = (await call("dev", "GET", "/v1/dev/products")).json()[0];
    expect(row.reviewNote).toBeNull();
  });

  it("estadísticas, ocultar/mostrar y edición de publicado", async () => {
    await call("otro", "POST", `/v1/library/${slug}`);
    expect((await call("dev", "GET", "/v1/dev/products")).json()[0].stats).toMatchObject({ owners: 1, wishlists: 0, reviews: 0 });
    expect((await call("dev", "POST", `/v1/dev/products/${slug}/hide`)).statusCode).toBe(204);
    expect((await call(null, "GET", `/v1/products/${slug}`)).statusCode).toBe(404);
    expect((await call("dev", "POST", `/v1/dev/products/${slug}/show`)).statusCode).toBe(204);
    expect((await call("dev", "PUT", `/v1/dev/products/${slug}`, { ...product, name: "Nombre nuevo" })).statusCode).toBe(204);
    const pub = (await call(null, "GET", `/v1/products/${slug}`)).json();
    expect(pub.name).toBe("Nombre nuevo");
    expect((await call("dev", "POST", `/v1/dev/products/${slug}/submit`)).json().error).toBe("invalid_status");
  });
});
