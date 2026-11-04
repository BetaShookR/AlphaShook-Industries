import { z } from "zod";

/** Identidad pública de la tienda. Se lee desde la BD (tabla settings), nunca hardcodeada. */
export const storeIdentitySchema = z.object({
  name: z.string().min(1).max(64),
  logoUrl: z.string().url().nullable(),
});
export type StoreIdentity = z.infer<typeof storeIdentitySchema>;

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["up", "down"]),
  uptimeSec: z.number(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export * from "./auth.js";
export * from "./catalog.js";
