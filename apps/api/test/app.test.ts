import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";

const env = loadEnv({ ...process.env, NODE_ENV: "test" });
const { db, sql } = createDb(env.DATABASE_URL);
const app = buildApp(env, db);

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await sql.end();
});

describe("API base", () => {
  it("GET /health responde ok con BD activa", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", db: "up" });
  });

  it("GET /v1/store/identity devuelve la identidad sembrada", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/store/identity" });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBeTypeOf("string");
  });

  it("ruta inexistente devuelve 404", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("loadEnv rechaza configuración inválida", () => {
    expect(() => loadEnv({ DATABASE_URL: "no-es-url" })).toThrow(/Configuración inválida/);
  });
});
