import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { importProducts } from "../src/modules/catalog/import.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000" });
const { db, sql } = createDb(env.DATABASE_URL);
const app = buildApp(env, db, { mailer: new MemoryMailer() });
const sfx = Math.random().toString(36).slice(2, 8);
const s = (n: string) => `lib-${n}-${sfx}`;
const base = { shortDescription: "x", description: "x", developer: { slug: s("dev"), name: "Dev" }, status: "published" };
let A = "", B = "";
const h = (t: string) => ({ authorization: `Bearer ${t}` });
const call = (t: string, method: string, url: string) => app.inject({ method: method as "GET", url, headers: h(t) });

async function account(n: string) {
  const r = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { username: `L${n}_${sfx}`, email: `l${n}_${sfx}@example.com`, password: "clave-segura-1", passwordConfirm: "clave-segura-1", acceptTerms: true, deviceType: "launcher" },
  });
  return r.json().token as string;
}

beforeAll(async () => {
  await app.ready();
  await importProducts(db, { products: [
    { ...base, slug: s("gratis"), name: "Gratis", priceCents: 0, categories: ["indie"], platforms: ["windows"],
      releases: [{ version: "1.0", platform: "windows", sizeBytes: 10 }, { version: "1.1", platform: "windows", sizeBytes: 20 }] },
    { ...base, slug: s("pago"), name: "Pago", priceCents: 500 },
    { ...base, slug: s("draft"), name: "Draft", status: "draft" },
  ] });
  A = await account("a");
  B = await account("b");
});

afterAll(async () => {
  await sql`delete from users where email like ${"%_" + sfx + "@example.com"}`;
  await sql`delete from products where slug like ${"lib-%-" + sfx}`;
  await sql`delete from organizations where slug = ${s("dev")}`;
  await app.close();
  await sql.end();
});

describe("biblioteca", () => {
  it("requiere sesión", async () => {
    expect((await app.inject({ url: "/v1/library" })).statusCode).toBe(401);
  });

  it("agrega un producto gratuito una sola vez", async () => {
    expect((await call(A, "POST", `/v1/library/${s("gratis")}`)).statusCode).toBe(201);
    const again = await call(A, "POST", `/v1/library/${s("gratis")}`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_owned");
  });

  it("rechaza pagos, borradores e inexistentes", async () => {
    expect((await call(A, "POST", `/v1/library/${s("pago")}`)).json().error).toBe("payment_required");
    expect((await call(A, "POST", `/v1/library/${s("draft")}`)).statusCode).toBe(404);
    expect((await call(A, "POST", "/v1/library/no-existe-xyz")).statusCode).toBe(404);
  });

  it("lista con categorías, última versión y filtros", async () => {
    const list = (await call(A, "GET", "/v1/library")).json();
    expect(list).toHaveLength(1);
    expect(list[0].product.slug).toBe(s("gratis"));
    expect(list[0].source).toBe("free");
    expect(list[0].categories[0].slug).toBe("indie");
    expect(list[0].latestReleases).toEqual([{ version: "1.1", platform: "windows", sizeBytes: 20 }]);
    expect((await call(A, "GET", "/v1/library?q=nada")).json()).toHaveLength(0);
    expect((await call(A, "GET", "/v1/library?category=terror")).json()).toHaveLength(0);
  });

  it("es independiente por usuario y se ve desde cualquier dispositivo", async () => {
    expect((await call(B, "GET", "/v1/library")).json()).toHaveLength(0);
    const web = await app.inject({ method: "POST", url: "/v1/auth/login",
      payload: { identifier: `la_${sfx}@example.com`, password: "clave-segura-1", deviceType: "web" } });
    const cookies = { as_session: web.cookies.find((c) => c.name === "as_session")!.value };
    expect((await app.inject({ url: "/v1/library", cookies })).json()).toHaveLength(1);
  });

  it("se conserva aunque el producto se oculte", async () => {
    await sql`update products set status = 'hidden' where slug = ${s("gratis")}`;
    expect((await call(A, "GET", "/v1/library")).json()).toHaveLength(1);
    await sql`update products set status = 'published' where slug = ${s("gratis")}`;
  });
});

describe("lista de deseos y estado", () => {
  it("agrega, lista y quita", async () => {
    expect((await call(B, "PUT", `/v1/wishlist/${s("pago")}`)).statusCode).toBe(204);
    expect((await call(B, "PUT", `/v1/wishlist/${s("pago")}`)).statusCode).toBe(204);
    expect((await call(B, "GET", "/v1/wishlist")).json()).toHaveLength(1);
    expect((await call(B, "GET", `/v1/me/products/${s("pago")}`)).json()).toEqual({ owned: false, wishlisted: true });
    expect((await call(B, "DELETE", `/v1/wishlist/${s("pago")}`)).statusCode).toBe(204);
    expect((await call(B, "GET", "/v1/wishlist")).json()).toHaveLength(0);
  });

  it("no deja desear algo que ya tenés, y adquirir lo quita de la lista", async () => {
    expect((await call(A, "PUT", `/v1/wishlist/${s("gratis")}`)).statusCode).toBe(409);
    await call(B, "PUT", `/v1/wishlist/${s("gratis")}`);
    await call(B, "POST", `/v1/library/${s("gratis")}`);
    expect((await call(B, "GET", `/v1/me/products/${s("gratis")}`)).json()).toEqual({ owned: true, wishlisted: false });
  });
});
