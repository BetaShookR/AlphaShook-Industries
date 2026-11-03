# Decisiones técnicas

| # | Fecha | Decisión | Motivo |
|---|---|---|---|
| 1 | 2026-11-03 | Monorepo pnpm workspaces | Tipos y cliente API compartidos entre web, launcher y Android |
| 2 | 2026-11-03 | Drizzle ORM + drizzle-kit | Migraciones SQL versionadas, liviano |
| 3 | 2026-11-03 | Fastify 5 | Rendimiento y logging/validación integrados |
| 4 | 2026-11-03 | Driver `postgres` (postgres.js) | Sin dependencias nativas; funciona igual en Windows |
| 5 | 2026-11-03 | Node 24 LTS; PostgreSQL 17 nativo en desarrollo | Entorno del usuario (Windows 10) |
| 6 | 2026-11-03 | Identidad de la tienda en tabla `settings` (clave `store.identity`) | Nombre configurable sin tocar código |
| 7 | 2026-11-03 | Sin Turborepo por ahora | `pnpm -r` alcanza; se agrega si los builds se vuelven lentos |
| 8 | 2026-11-03 | Vitest para tests | Nativo TS/ESM, sin configuración extra |
