import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { importProducts } from "../src/modules/catalog/import.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000", COMMUNITY_WRITE_LIMIT_MAX: "1000" });
const { db, sql } = createDb(env.DATABASE_URL);
const app = buildApp(env, db, { mailer: new MemoryMailer() });
const sfx = Math.random().toString(36).slice(2, 8);
const s = (n: string) => `com-${n}-${sfx}`;
const name = (n: string) => `C${n}_${sfx}`;
const base = { shortDescription: "x", description: "x", developer: { slug: s("dev"), name: "Dev" }, status: "published" };
const tok: Record<string, string> = {};

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (who: string | null, method: M, url: string, payload?: unknown) =>
  app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }), headers: who ? { authorization: `Bearer ${tok[who]}` } : {} });

async function account(n: string) {
  const r = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { username: name(n), email: `c${n}_${sfx}@example.com`, password: "clave-segura-1", passwordConfirm: "clave-segura-1", acceptTerms: true, deviceType: "launcher" },
  });
  tok[n] = r.json().token;
}

beforeAll(async () => {
  await app.ready();
  await importProducts(db, { products: [
    { ...base, slug: s("juego"), name: "Juego", priceCents: 0 },
    { ...base, slug: s("draft"), name: "Draft", priceCents: 0, status: "draft" },
  ] });
  for (const n of ["a", "b", "c", "mod"]) await account(n);
  await sql`update users set role = 'moderator' where username = ${name("mod")}`;
  await call("a", "POST", `/v1/library/${s("juego")}`);
  await call("b", "POST", `/v1/library/${s("juego")}`);
});

afterAll(async () => {
  await sql`delete from users where email like ${"%_" + sfx + "@example.com"}`;
  await sql`delete from products where slug like ${"com-%-" + sfx}`;
  await sql`delete from organizations where slug = ${s("dev")}`;
  await app.close();
  await sql.end();
});

describe("reseñas y valoraciones", () => {
  const url = () => `/v1/products/${s("juego")}/review`;
  const list = (who: string | null = null) => call(who, "GET", `/v1/products/${s("juego")}/reviews`);

  it("requiere sesión, producto en biblioteca y datos válidos", async () => {
    expect((await call(null, "PUT", url(), { rating: 5, body: "Muy bueno el juego" })).statusCode).toBe(401);
    const notOwned = await call("c", "PUT", url(), { rating: 5, body: "Muy bueno el juego" });
    expect(notOwned.statusCode).toBe(403);
    expect(notOwned.json().error).toBe("not_owned");
    expect((await call("a", "PUT", url(), { rating: 6, body: "Muy bueno el juego" })).statusCode).toBe(400);
    expect((await call("a", "PUT", url(), { rating: 4, body: "corto" })).statusCode).toBe(400);
    expect((await call("a", "PUT", `/v1/products/${s("draft")}/review`, { rating: 4, body: "Muy bueno el juego" })).statusCode).toBe(404);
  });

  it("crea, edita (una por usuario) y calcula el resumen", async () => {
    expect((await call("a", "PUT", url(), { rating: 2, body: "Primera opinión del juego" })).statusCode).toBe(201);
    expect((await call("a", "PUT", url(), { rating: 4, body: "Opinión corregida del juego" })).statusCode).toBe(200);
    expect((await call("b", "PUT", url(), { rating: 5, body: "Excelente, lo recomiendo" })).statusCode).toBe(201);
    const page = (await list("a")).json();
    expect(page.summary).toEqual({ count: 2, average: 4.5, distribution: [0, 0, 0, 1, 1] });
    expect(page.items).toHaveLength(2);
    expect(page.mine.body).toBe("Opinión corregida del juego");
    expect(page.canReview).toBe(true);
    const anon = (await list()).json();
    expect(anon.mine).toBeNull();
    expect(anon.canReview).toBe(false);
    expect(anon.items[0].user).not.toHaveProperty("email");
  });

  it("moderación oculta reseñas y solo moderadores pueden hacerlo", async () => {
    const id = (await list("b")).json().mine.id;
    expect((await call("a", "PATCH", `/v1/mod/reviews/${id}`, { hidden: true })).statusCode).toBe(403);
    expect((await call("mod", "PATCH", `/v1/mod/reviews/${id}`, { hidden: true })).statusCode).toBe(204);
    expect((await list()).json().summary.count).toBe(1);
    await call("mod", "PATCH", `/v1/mod/reviews/${id}`, { hidden: false });
  });

  it("el autor puede borrar su reseña", async () => {
    expect((await call("b", "DELETE", url())).statusCode).toBe(204);
    expect((await list()).json().summary.count).toBe(1);
  });
});

describe("perfiles y amigos", () => {
  it("perfil público sin datos sensibles y edición propia", async () => {
    const p = (await call(null, "GET", `/v1/users/${name("a")}`)).json();
    expect(p.username).toBe(name("a"));
    expect(p).not.toHaveProperty("email");
    expect(p.library.map((l: { slug: string }) => l.slug)).toContain(s("juego"));
    expect(p.reviews).toHaveLength(1);
    expect(p.friendState).toBeNull();
    const upd = await call("a", "PATCH", "/v1/me/profile", { displayName: "Andy", bio: "Hola", visibility: "friends" });
    expect(upd.json()).toEqual({ displayName: "Andy", bio: "Hola", visibility: "friends" });
    expect((await call(null, "GET", "/v1/users/no_existe_zz")).statusCode).toBe(404);
  });

  it("solicitud, aceptación y privacidad 'solo amigos'", async () => {
    expect((await call("b", "GET", `/v1/users/${name("a")}`)).json().library).toBeNull();
    expect((await call("b", "POST", `/v1/friends/${name("b")}`)).json().error).toBe("cannot_friend_self");
    expect((await call("b", "POST", `/v1/friends/${name("a")}`)).statusCode).toBe(201);
    expect((await call("b", "POST", `/v1/friends/${name("a")}`)).json().error).toBe("request_already_sent");
    expect((await call("b", "GET", `/v1/users/${name("a")}`)).json().friendState).toBe("request_sent");
    const fa = (await call("a", "GET", "/v1/friends")).json();
    expect(fa.incoming.map((f: { username: string }) => f.username)).toEqual([name("b")]);
    expect((await call("a", "POST", `/v1/friends/${name("b")}/accept`)).statusCode).toBe(200);
    const pb = (await call("b", "GET", `/v1/users/${name("a")}`)).json();
    expect(pb.friendState).toBe("friends");
    expect(pb.library).not.toBeNull();
    expect(pb.bio).toBe("Hola");
    expect(pb.friendCount).toBe(1);
    expect((await call("c", "GET", `/v1/users/${name("a")}`)).json().library).toBeNull();
  });

  it("solicitud cruzada se acepta sola y se puede eliminar", async () => {
    expect((await call("c", "POST", `/v1/friends/${name("b")}`)).statusCode).toBe(201);
    expect((await call("b", "POST", `/v1/friends/${name("c")}`)).json().status).toBe("accepted");
    expect((await call("b", "GET", "/v1/friends")).json().friends).toHaveLength(2);
    expect((await call("c", "DELETE", `/v1/friends/${name("b")}`)).statusCode).toBe(204);
    expect((await call("b", "GET", "/v1/friends")).json().friends).toHaveLength(1);
    expect((await call("b", "POST", `/v1/friends/${name("c")}/accept`)).statusCode).toBe(404);
  });
});

describe("foros", () => {
  let general = "", gameThread = "";

  it("crea hilos en el foro general y de producto", async () => {
    expect((await call(null, "POST", "/v1/forums/threads", { title: "Hola", body: "x" })).statusCode).toBe(401);
    expect((await call("a", "POST", "/v1/forums/threads", { title: "abc", body: "cuerpo" })).statusCode).toBe(400);
    expect((await call("a", "POST", "/v1/forums/threads", { product: s("draft"), title: "Sobre el draft", body: "cuerpo" })).statusCode).toBe(404);
    general = (await call("a", "POST", "/v1/forums/threads", { title: "Presentaciones", body: "Hola a todos" })).json().id;
    gameThread = (await call("c", "POST", "/v1/forums/threads", { product: s("juego"), title: "Bug en nivel 2", body: "Se cuelga" })).json().id;
    const boards = (await call(null, "GET", "/v1/forums")).json();
    expect(boards[0].product).toBeNull();
    expect(boards.find((b: { product: { slug: string } | null }) => b.product?.slug === s("juego")).threadCount).toBe(1);
    const t = (await call(null, "GET", `/v1/forums/${s("juego")}/threads`)).json();
    expect(t.items[0].id).toBe(gameThread);
  });

  it("responde, edita lo propio y respeta el bloqueo", async () => {
    const r = await call("b", "POST", `/v1/forums/threads/${general}/posts`, { body: "Bienvenido" });
    expect(r.statusCode).toBe(201);
    const postId = r.json().id;
    expect((await call("a", "PATCH", `/v1/forums/posts/${postId}`, { body: "hackeado" })).statusCode).toBe(403);
    expect((await call("b", "PATCH", `/v1/forums/posts/${postId}`, { body: "Bienvenido!!" })).statusCode).toBe(204);
    let page = (await call(null, "GET", `/v1/forums/threads/${general}`)).json();
    expect(page.thread.postCount).toBe(2);
    expect(page.posts.map((p: { body: string }) => p.body)).toEqual(["Hola a todos", "Bienvenido!!"]);
    expect(page.posts[1].editedAt).not.toBeNull();

    expect((await call("a", "PATCH", `/v1/mod/threads/${general}`, { locked: true })).statusCode).toBe(403);
    expect((await call("mod", "PATCH", `/v1/mod/threads/${general}`, { locked: true })).statusCode).toBe(204);
    expect((await call("b", "POST", `/v1/forums/threads/${general}/posts`, { body: "otra vez" })).json().error).toBe("thread_locked");
    expect((await call("mod", "POST", `/v1/forums/threads/${general}/posts`, { body: "Cerrado por moderación" })).statusCode).toBe(201);

    expect((await call("mod", "PATCH", `/v1/mod/posts/${postId}`, { hidden: true })).statusCode).toBe(204);
    page = (await call(null, "GET", `/v1/forums/threads/${general}`)).json();
    expect(page.posts[1]).toMatchObject({ hidden: true, body: "" });
    expect((await call("mod", "GET", `/v1/forums/threads/${general}`)).json().posts[1].body).toBe("Bienvenido!!");
  });

  it("hilos ocultos solo para moderación; ids inválidos dan 404", async () => {
    await call("mod", "PATCH", `/v1/mod/threads/${gameThread}`, { hidden: true });
    expect((await call(null, "GET", `/v1/forums/threads/${gameThread}`)).statusCode).toBe(404);
    expect((await call("mod", "GET", `/v1/forums/threads/${gameThread}`)).statusCode).toBe(200);
    expect((await call(null, "GET", `/v1/forums/${s("juego")}/threads`)).json().total).toBe(0);
    expect((await call(null, "GET", "/v1/forums/threads/no-es-uuid")).statusCode).toBe(404);
  });
});
