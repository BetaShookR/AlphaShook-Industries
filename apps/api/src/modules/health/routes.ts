import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@alphashook/shared";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    let db: HealthResponse["db"] = "up";
    try {
      await app.db.execute(sql`select 1`);
    } catch (err) {
      app.log.error({ err }, "health: BD no responde");
      db = "down";
    }
    const body: HealthResponse = {
      status: db === "up" ? "ok" : "degraded",
      db,
      uptimeSec: Math.round(process.uptime()),
    };
    return reply.code(db === "up" ? 200 : 503).send(body);
  });
};
