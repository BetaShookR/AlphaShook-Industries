import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { importProducts } from "../src/modules/catalog/import.js";
import { MemoryMailer } from "../src/lib/mailer.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test" });
const { db, sql } = createDb(env.DATABASE_URL);
const app = buildApp(env, db, { mailer: new MemoryMailer() });
const sfx = Math.random().toString(36).slice(2, 8);
const s = (n: string) => `test-${n}-${sfx}`;

const base = {
  shortDescription: "Descripción breve",
  description: "Descripción completa",
  developer: { slug: s("dev"), name: "Estudio de prueba" },
  categories: ["accion"],
};

beforeAll(async () => {
  await app.ready();
  await importProducts(db, {
    products: [
      {
        ...base, slug: s("alfa"), name: `Zafiro Quest ${sfx}`, status: "published", featured: true,
        priceCents: 0, releaseDate: "2026-10-01", platforms: ["windows", "linux"],
        tags: [{ slug: s("tag"), name: "Pixel art" }],
        media: [{ url: "https://example.com/1.png" }],
        requirements: [{ platform: "windows", level: "minimum", specs: { os: "Windows 10", ram: "4 GB" } }],
        releases: [
          { version: "1.0.0", platform: "windows", sizeBytes: 1000 },
          { version: "1.1.0", platform: "windows", sizeBytes: 1200 },
        ],
      },
      { ...base, slug: s("beta"), name: `Ámbar Racer ${sfx}`, status: "published", priceCents: 999, categories: ["carreras"] },
      { ...base, slug: s("borrador"), name: `Oculto ${sfx}`, status: "draft" },
    ],
  });
});

afterAll(async () => {
  await sql`delete from products where slug like ${"test-%-" + sfx}`;
  await sql`delete from organizations where slug = ${s("dev")}`;
  await sql`delete from tags where slug = ${s("tag")}`;
  await app.close();
  await sql.end();
});

describe("catálogo", () => {
  it("lista solo publicados y busca por nombre", async () => {
    const r = (await app.inject({ url: `/v1/products?q=${sfx}` })).json();
    expect(r.total).toBe(2);
    expect(r.items.map((i: { slug: string }) => i.slug)).not.toContain(s("borrador"));
    const one = (await app.inject({ url: `/v1/products?q=${encodeURIComponent("zafiro " + sfx)}` })).json();
    expect(one.items[0].slug).toBe(s("alfa"));
  });

  it("filtra por categoría y ordena por precio", async () => {
    const r = (await app.inject({ url: `/v1/products?q=${sfx}&category=carreras` })).json();
    expect(r.items.map((i: { slug: string }) => i.slug)).toEqual([s("beta")]);
    const desc = (await app.inject({ url: `/v1/products?q=${sfx}&sort=price_desc` })).json();
    expect(desc.items[0].priceCents).toBe(999);
  });

  it("valida parámetros", async () => {
    expect((await app.inject({ url: "/v1/products?limit=999" })).statusCode).toBe(400);
  });

  it("detalle con relaciones y última versión por plataforma", async () => {
    const r = await app.inject({ url: `/v1/products/${s("alfa")}` });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.developer.name).toBe("Estudio de prueba");
    expect(p.publisher.slug).toBe(s("dev"));
    expect(p.categories[0].slug).toBe("accion");
    expect(p.tags[0].name).toBe("Pixel art");
    expect(p.requirements[0].specs.ram).toBe("4 GB");
    expect(p.releases).toHaveLength(2);
    expect(p.latestReleases).toHaveLength(1);
  });

  it("borradores e inexistentes devuelven 404", async () => {
    expect((await app.inject({ url: `/v1/products/${s("borrador")}` })).statusCode).toBe(404);
    expect((await app.inject({ url: "/v1/products/NO_VALIDO" })).statusCode).toBe(404);
  });

  it("home incluye destacados, recientes y categorías base", async () => {
    const h = (await app.inject({ url: "/v1/home" })).json();
    expect(h.featured.some((p: { slug: string }) => p.slug === s("alfa"))).toBe(true);
    expect(h.categories.length).toBeGreaterThanOrEqual(14);
  });

  it("reimportar actualiza sin duplicar y rechaza categorías inexistentes", async () => {
    const res = await importProducts(db, { products: [{ ...base, slug: s("beta"), name: "Renombrado", status: "published" }] });
    expect(res[0]!.action).toBe("updated");
    await expect(importProducts(db, { products: [{ ...base, slug: s("x"), name: "X", categories: ["no-existe"] }] }))
      .rejects.toThrow(/categorías inexistentes/);
  });
});
