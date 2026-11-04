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
| 9 | 2026-11-03 | Sesiones con token opaco (256 bits) guardado como SHA-256, 30 días, sin JWT | Revocación inmediata por dispositivo; una consulta por request es barata |
| 10 | 2026-11-03 | Argon2id (`@node-rs/argon2`, OWASP: 19 MiB, t=2, p=1) | Requisito de la especificación; binario precompilado para Windows/Linux |
| 11 | 2026-11-03 | `@fastify/rate-limit` por IP en rutas de auth (10/min, configurable) | Protección contra intentos automatizados; en memoria hasta tener varias instancias |
| 12 | 2026-11-03 | Rol único en `users.role` (user/developer/moderator/admin) | Suficiente hasta el portal de desarrolladores; se normaliza si hace falta |
| 13 | 2026-11-03 | Correo vía interfaz `Mailer`; en desarrollo `LogMailer` (registra en log) | Proveedor real se elige antes de producción |
| 14 | 2026-11-03 | Web: sesión en cookie httpOnly + SameSite=Lax (`as_session`); launcher/Android: Bearer | El token no es accesible desde JS (mitiga XSS); Lax bloquea envíos cross-site |
| 15 | 2026-11-03 | Vite proxy `/v1` → API en desarrollo | Mismo origen: sin CORS ni dependencia extra |
| 16 | 2026-11-03 | Web sin librería de estado/caché (fetch + hook propio) | Suficiente para el alcance actual; TanStack Query se evalúa si crece |
| 17 | 2026-11-03 | Búsqueda: `tsvector` generado ('simple') + índice GIN, con fallback ILIKE por nombre | Sin servicios externos; funciona en cualquier idioma |
| 18 | 2026-11-03 | Carga de productos por JSON (`pnpm catalog:import`) hasta el portal de desarrolladores | Permite publicar productos reales sin panel; sin datos ficticios en la tienda |
| 19 | 2026-11-03 | "Populares", promociones y recomendaciones se omiten en la home hasta tener datos (estadísticas/etapa 9) | No mostrar contenido simulado |
| 20 | 2026-11-03 | Funciones de comunidad (foros, reseñas, perfiles públicos, amigos) como etapa 4b; panel admin se mantiene en Etapa 9, protegido por rol (no por URL oculta) | Pedido del usuario; respeta el orden de etapas |
| 21 | 2026-11-03 | `requireAuth` reutilizable (`makeRequireAuth`) para todos los módulos | Un solo punto de autenticación Bearer/cookie |
| 22 | 2026-11-03 | Producción: un solo servicio Render (API sirve la web) + PostgreSQL en Neon | Mismo origen para la cookie; Postgres gratis de Render vence a los 30 días |
| 23 | 2026-11-03 | Correo con Brevo vía API HTTP (sin SDK) | Plan gratis y permite remitente verificado sin dominio propio |
