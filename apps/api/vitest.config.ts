import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgres://alphashook:alphashook@localhost:5432/alphashook" } },
});
