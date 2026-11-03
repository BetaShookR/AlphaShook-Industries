import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Configuración global clave/valor (identidad de la tienda, flags, etc.). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
