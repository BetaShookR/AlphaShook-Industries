import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, MemoryStorage } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { MemoryMailer } from "../src/lib/mailer.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000", COMMUNITY_WRITE_LIMIT_MAX: "1000" });
const { db, sql } = createDb(env.DATABASE_URL);
const storage = new MemoryStorage();
const app = buildApp(env, db, { mailer: new MemoryMailer(), storage });
const noStorage = buildApp(env, db, { mailer: new MemoryMailer(), storage: null });
const sfx = Math.random().toString(36).slice(2, 8);
const slug = `rel-juego-${sfx}`;
const tok: Record<string, string> = {};
type M = "GET" | "POST" | "PUT" | "DELETE";
const call = (who: string, method: M, url: string, payload?: unknown, a = app) =>
  a.inject({ method, url, ...(payload !== undefined && { payload: payload as object }), headers: { authorization: `Bearer ${tok[who]}` } });

const zip = Buffer.from("PK\u0003\u0004 contenido de prueba del juego");
const sha = createHash("sha256").update(zip).digest("hex");
const rel = (o: object = {}) => ({ version: "1.0.0", platform: "windows", fileName: "Juego Win.zip", sizeBytes: zip.length, launchPath: "bin\\Juego.exe", ...o });
const keyOf = (url: string) => url.replace("memory://put/", "");
const waitReady = async (id: string) => {
  for (let i = 0; i < 50; i++) {
    const r = (await call("admin", "GET", `/v1/dev/products/${slug}/releases`)).json().find((x: { id: string }) => x.id === id);
    if (r.status !== "verifying") return r;
    await new Promise((res) => setTimeout(res, 20));
  }
};

beforeAll(async () => {
  await app.ready();
  await noStorage.ready();
  for (const n of ["admin", "jugador", "otro"]) {
    const r = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
      username: `R${n}_${sfx}`, email: `r${n}_${sfx}@example.com`, password: "clave-segura-1", passwordConfirm: "clave-segura-1", acceptTerms: true, deviceType: "launcher" } });
    tok[n] = r.json().token;
  }
  await sql`update users set role = 'admin' where username = ${"Radmin_" + sfx}`;
  const org = (await call("admin", "GET", "/v1/dev/orgs")).json()[0].slug;
  expect((await call("admin", "POST", "/v1/dev/products", { org, slug, name: "Juego con archivos", shortDescription: "Juego para probar descargas",
    description: "Descripción larga del juego para probar descargas.", priceCents: 0, platforms: ["windows"], categories: ["indie"], tags: [], media: [], coverUrl: "", requirements: [] })).statusCode).toBe(201);
  await call("admin", "POST", `/v1/dev/products/${slug}/submit`);
  await call("admin", "POST", `/v1/admin/review/${slug}/approve`, {});
});

afterAll(async () => {
  await sql`delete from library_entries where product_id in (select id from products where slug = ${slug})`;
  await sql`delete from users where email like ${"%_" + sfx + "@example.com"}`;
  await sql`delete from products where slug = ${slug}`;
  await app.close();
  await noStorage.close();
  await sql.end();
});

describe("versiones con archivo", () => {
  let id = "";
  it("sin R2 configurado responde 503", async () => {
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel(), noStorage)).json().error).toBe("storage_not_configured");
  });

  it("valida datos, plataforma del producto y permisos", async () => {
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ fileName: "juego.exe" }))).statusCode).toBe(400);
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ launchPath: "../evil.exe" }))).statusCode).toBe(400);
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ sizeBytes: 6 * 1024 ** 3 }))).statusCode).toBe(400);
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ platform: "linux" }))).json().error).toBe("platform_not_in_product");
    expect((await call("otro", "POST", `/v1/dev/products/${slug}/releases`, rel())).statusCode).toBe(404);
    expect((await call("otro", "GET", `/v1/dev/products/${slug}/releases`)).statusCode).toBe(404);
  });

  it("crea, sube, verifica SHA-256 y queda lista", async () => {
    const r = await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel());
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel())).json().error).toBe("version_exists");
    // Antes de subir: no aparece en la tienda y "complete" falla.
    expect((await app.inject({ url: `/v1/products/${slug}` })).json().latestReleases).toHaveLength(0);
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases/${id}/complete`)).json().error).toBe("file_missing");
    storage.put(keyOf(r.json().uploadUrl), zip);
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases/${id}/complete`)).statusCode).toBe(202);
    const done = await waitReady(id);
    expect(done).toMatchObject({ status: "ready", sha256: sha, launchPath: "bin/Juego.exe", fileName: "Juego Win.zip" });
    expect((await app.inject({ url: `/v1/products/${slug}` })).json().latestReleases[0].version).toBe("1.0.0");
  });

  it("rechaza un archivo de tamaño distinto", async () => {
    const r = await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ version: "1.0.1" }));
    storage.put(keyOf(r.json().uploadUrl), Buffer.from("otro"));
    expect((await call("admin", "POST", `/v1/dev/products/${slug}/releases/${r.json().id}/complete`)).json().error).toBe("size_mismatch");
    const list = (await call("admin", "GET", `/v1/dev/products/${slug}/releases`)).json();
    expect(list.find((x: { id: string }) => x.id === r.json().id).status).toBe("failed");
    expect((await call("admin", "DELETE", `/v1/dev/products/${slug}/releases/${r.json().id}`)).statusCode).toBe(204);
    expect(storage.objects.has(keyOf(r.json().uploadUrl))).toBe(false);
  });

  it("descarga: solo con el producto en la biblioteca, devuelve la última versión", async () => {
    const url = `/v1/library/${slug}/download?platform=windows`;
    expect((await call("jugador", "GET", url)).json().error).toBe("not_owned");
    await call("jugador", "POST", `/v1/library/${slug}`);
    expect((await call("jugador", "GET", `/v1/library/${slug}/download?platform=mac`)).statusCode).toBe(400);
    expect((await call("jugador", "GET", `/v1/library/${slug}/download?platform=linux`)).json().error).toBe("no_release");
    const t = (await call("jugador", "GET", url)).json();
    expect(t).toMatchObject({ version: "1.0.0", sha256: sha, sizeBytes: zip.length, launchPath: "bin/Juego.exe" });
    expect(t.url).toContain("memory://get/");
    // Nueva versión → la descarga pasa a 1.1.0
    const r = await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ version: "1.1.0" }));
    storage.put(keyOf(r.json().uploadUrl), zip);
    await call("admin", "POST", `/v1/dev/products/${slug}/releases/${r.json().id}/complete`);
    await waitReady(r.json().id);
    expect((await call("jugador", "GET", url)).json().version).toBe("1.1.0");
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
  });
});

describe("ajustes de R2 y validaciones extra", () => {
  it("acepta el endpoint con el bucket al final y rechaza .apk en Windows", async () => {
    const { R2Storage } = await import("../src/lib/storage.js");
    const s = new R2Storage({ endpoint: "https://abc.r2.cloudflarestorage.com/alphashook-files/", bucket: "alphashook-files", accessKeyId: "a", secretAccessKey: "b" });
    expect(await s.presignGet("k.zip", 60)).toMatch(/^https:\/\/abc\.r2\.cloudflarestorage\.com\/alphashook-files\/k\.zip\?/);
    const r = await call("admin", "POST", `/v1/dev/products/${slug}/releases`, rel({ version: "9.9.9", launchPath: "Juego.apk" }));
    expect(r.json().details[0].path).toBe("launchPath");
  });
});

describe("sesión deslizante", () => {
  it("renueva el vencimiento cuando la sesión se usa", async () => {
    const u = `Rjugador_${sfx}`;
    await sql`update sessions set expires_at = now() + interval '5 days', last_used_at = now() - interval '2 minutes'
      where user_id = (select id from users where username = ${u})`;
    expect((await call("jugador", "GET", "/v1/me")).statusCode).toBe(200);
    const [r] = await sql`select expires_at from sessions where user_id = (select id from users where username = ${u})`;
    expect(new Date(r!.expires_at).getTime() - Date.now()).toBeGreaterThan(25 * 24 * 3600 * 1000);
  });
});
