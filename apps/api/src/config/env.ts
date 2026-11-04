import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(""),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  COMMUNITY_WRITE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  /** Carpeta del build de la tienda web; si existe, la API también la sirve (un solo servicio). */
  WEB_DIST_DIR: z.string().optional(),
  MAIL_PROVIDER: z.enum(["log", "brevo"]).default("log"),
  BREVO_API_KEY: z.string().optional(),
  MAIL_FROM_EMAIL: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().default("AlphaShook"),
  /** Cloudflare R2 (S3 compatible). Sin estas 4 variables, subir/descargar archivos responde 503. */
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
}).superRefine((e, ctx) => {
  if (e.MAIL_PROVIDER === "brevo" && (!e.BREVO_API_KEY || !e.MAIL_FROM_EMAIL)) {
    ctx.addIssue({ code: "custom", path: ["BREVO_API_KEY"], message: "MAIL_PROVIDER=brevo requiere BREVO_API_KEY y MAIL_FROM_EMAIL" });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Valida variables de entorno al arrancar; falla rápido si falta algo. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${issues}`);
  }
  return parsed.data;
}
