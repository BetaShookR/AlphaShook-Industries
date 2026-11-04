# PROJECT_STATUS — AlphaShook

Última actualización: 2026-11-04

| Etapa | Estado |
|---|---|
| 0. Análisis y planificación | ✅ Terminada |
| 1. Fundaciones (monorepo, API base, BD, migraciones, CI) | ✅ Terminada — verificada completa en Windows 10 + PG 17.11 (incl. tests) |
| 2. Cuentas (backend) | ✅ Terminada — verificada en Windows 10 + PG 17.11 (18/18 tests) |
| 3. Catálogo y tienda web | ✅ Terminada — verificada en Windows (tienda funcionando con `iniciar.bat`) |
| 4. Biblioteca, productos gratuitos y lista de deseos | ✅ Terminada — verificada en Windows (biblioteca y catálogo con juegos reales) |
| 4b. Comunidad: foros, reseñas y valoraciones, perfiles públicos, amigos | ✅ Terminada — probada en Linux/PG16; falta verificar en Windows y publicar |
| 5. Portal de desarrolladores (sin subida de archivos) | ✅ Terminada — probada en Linux/PG16; falta verificar en Windows y publicar |
| 6–10 | ⏳ Pendientes (6: launcher + subida/descarga de archivos con R2; 9: panel admin completo) |

## Etapa 1 — Terminado
- Monorepo pnpm: `apps/api`, `packages/shared`, `packages/config`.
- API Fastify + TS: validación de entorno (Zod), logging (pino), manejo de errores, cierre ordenado.
- Endpoints: `GET /health` (200/503 según BD), `GET /v1/store/identity` (desde tabla `settings`).
- Drizzle: migraciones `0000_init` (tabla `settings`) y `0001_seed_store_identity`.
- CI GitHub Actions (build, typecheck, migraciones, tests contra PG17).

## Probado
- `pnpm typecheck` y `pnpm build`: OK.
- `pnpm test`: 4/4 OK (health, identidad, 404, env inválido).
- Migraciones idempotentes (aplicadas 2 veces sin error).
- Servidor real: health 200 con BD arriba, 503 con BD caída; SIGINT cierra limpio.
- Windows 10 + PG 17.11: install, build, migraciones, `pnpm dev`, `GET /health` → `db: up` y `pnpm -r test` 4/4 (2026-11-03).

## Etapa 2 — Terminado
- Tablas `users`, `sessions`, `email_tokens` (migración `0002_auth`).
- Endpoints `/v1`: `auth/register`, `auth/login` (email o usuario), `auth/logout`, `me`, `auth/sessions` (listar, `DELETE :id`, `revoke-others`), `auth/verify-email` (+ `/resend`), `auth/password/forgot`, `auth/password/reset`.
- Argon2id, tokens hasheados de un solo uso, username único sin distinguir mayúsculas, rate limit, misma respuesta ante correos inexistentes, reset cierra todas las sesiones.
- Esquemas Zod compartidos en `packages/shared/src/auth.ts`.

## Probado (Etapa 2)
- Linux/PG16: typecheck, build, 18/18 tests (14 nuevos de auth), corridos 2 veces; registro real contra el servidor.
- Windows 10 + PG 17.11: migración 0002 aplicada, 18/18 tests (2026-11-03).

## Etapa 3 — Terminado
- BD (`0003_catalog`, `0004_seed_catalog_base`): organizaciones (4 divisiones internas sembradas), categorías (14 base), etiquetas, productos (búsqueda FTS), media, requisitos, versiones.
- API: `GET /v1/home`, `/v1/categories`, `/v1/products` (búsqueda, categoría, tipo, orden, paginación), `/v1/products/:slug`. Solo productos `published`.
- Importador de productos: `pnpm catalog:import <archivo.json>` (plantilla en `docs/catalog-template.json`).
- Sesión web por cookie httpOnly.
- `apps/web` (React + Vite): inicio, catálogo, producto, registro, login, verificación, recuperación, cuenta con sesiones. Nombre/logo desde `/v1/store/identity`. Adaptable a móvil.

## Probado (Etapa 3)
- Linux/PG16: typecheck, build, 26/26 tests de API (7 de catálogo, 1 de cookie).
- E2E en navegador (Playwright), 12/12: home, validación, registro, verificación, logout, login, cookie httpOnly, búsqueda, producto, persistencia de sesión, móvil sin scroll horizontal.

## Etapa 4 — Terminado
- BD (`0005_library`, `0006_release_clock`): `library_entries` (origen: free/purchase/gift/grant; no se borra al desinstalar), `wishlist_items`.
- API (requiere sesión): `GET /v1/library` (búsqueda y categoría; incluye última versión por plataforma), `POST /v1/library/:slug` (solo gratuitos; pagos → 402), `GET /v1/me/products/:slug` (en biblioteca / en deseados), `GET|PUT|DELETE /v1/wishlist[/:slug]`.
- Adquirir un producto lo quita de deseados; la biblioteca conserva productos aunque se oculten del catálogo.
- Web: botones en la página de producto, páginas Biblioteca y Deseados, menú visible en móvil.
- Corrección: versiones importadas juntas tenían la misma fecha → `published_at` usa `clock_timestamp()`.

## Probado (Etapa 4)
- Linux/PG16: 34/34 tests de API (8 nuevos de biblioteca/deseados, incluida sincronización launcher↔web).
- E2E en navegador 10/10: invitado, registro, biblioteca vacía, deseados, agregar gratis, quitar de deseados al adquirir, versiones, filtros, búsqueda, móvil.

## Etapa 4b — Terminado
- BD (`0007_community`): `profiles` (nombre visible, bio, visibilidad public/friends/private), `reviews` (1–5 + texto, una por usuario y producto, ocultable), `friendships` (un vínculo por par, pending/accepted), `forum_threads` (foro general o por producto; cerrar/ocultar), `forum_posts`.
- API `/v1`:
  - Reseñas: `GET /products/:slug/reviews` (resumen promedio + distribución, paginado, `mine`, `canReview`), `PUT|DELETE /products/:slug/review`. Solo con el producto en la biblioteca (403 `not_owned`).
  - Perfiles: `GET /users/:username` (sin correo; biblioteca y bio según privacidad), `GET|PATCH /me/profile`.
  - Amigos: `GET /friends`, `POST /friends/:username` (si el otro ya pidió, acepta), `POST /friends/:username/accept`, `DELETE /friends/:username` (eliminar/cancelar/rechazar). Máx. 100 solicitudes pendientes.
  - Foros: `GET /forums`, `GET /forums/:board/threads` (`general` o slug), `POST /forums/threads`, `GET /forums/threads/:id`, `POST /forums/threads/:id/posts`, `PATCH /forums/posts/:id` (solo autor).
  - Moderación (rol moderator/admin): `PATCH /mod/reviews/:id`, `/mod/threads/:id` (ocultar/cerrar), `/mod/posts/:id`.
  - Límite anti-spam en escrituras: `COMMUNITY_WRITE_LIMIT_MAX` (20/min por IP).
- Web: sección Reseñas en cada producto, Comunidad (`/community`, foros y temas), perfil público (`/u/:usuario`), Amigos (`/friends`), edición de perfil en Mi cuenta. Encabezado ajustado para 6 enlaces.

## Probado (Etapa 4b)
- Linux/PG16: typecheck y build OK; 44/44 tests de API (10 nuevos: reseñas, privacidad, amigos, foros, moderación, permisos).
- E2E en navegador (Playwright) con 2 cuentas: editar perfil, reseña bloqueada sin biblioteca, agregar y reseñar, crear tema, responder, privacidad "solo amigos" antes/después de aceptar, móvil 390 px y 800/1000/1280 px sin scroll horizontal.

## Etapa 5 — Terminado (decisión: archivos de instalación en Etapa 6)
- BD (`0008_developer_portal`): `developer_applications` (una pendiente por usuario), `org_members` (owner/member), `products.review_note` y `submitted_at`.
- Flujo: usuario solicita (`/developers`) → admin aprueba en `/admin` (crea estudio externo, lo agrega como dueño y le da rol developer) o rechaza con motivo.
- Productos: el desarrollador crea borradores, edita, envía a revisión, retira, oculta/vuelve a publicar. El admin publica o rechaza con motivo (vuelve a borrador). Editar un publicado se ve al instante; en revisión no se edita.
- Escritura de productos reutiliza el importador (una sola lógica). El slug no se puede cambiar ni usar uno ajeno. El admin puede gestionar todos los estudios (incluidos los internos).
- Estadísticas por producto: en bibliotecas, deseados, reseñas y promedio.
- API: `GET /v1/dev/status`, `POST /dev/application`, `GET /dev/orgs`, `GET|POST /dev/products`, `GET|PUT /dev/products/:slug`, `POST /dev/products/:slug/{submit,withdraw,hide,show}`; admin: `GET /admin/applications`, `POST /admin/applications/:id/{approve,reject}`, `GET /admin/review`, `POST /admin/review/:slug/{approve,reject}`.
- Web: `/developers`, `/dev`, `/dev/new`, `/dev/p/:slug`, `/admin`; botones Portal/Admin según rol; enlace en el pie.
- Corrección: detección de duplicados (23505) envuelta por drizzle también en comunidad.

## Probado (Etapa 5)
- Linux/PG16: typecheck y build OK; 50/50 tests de API (6 nuevos: solicitud, permisos, aprobación, borrador, rechazo/aprobación, estadísticas, ocultar).
- E2E en navegador: solicitar → aprobar → crear con requisitos/etiquetas → enviar → rechazar con motivo → corregir → publicar → visible en la tienda; 390/1000/1280 px sin scroll horizontal; sin errores JS.

## Herramienta: Panel AlphaShook
- `Panel AlphaShook.bat` abre `herramientas/panel.pyw` (Python + tkinter, sin dependencias): estado de la tienda online, iniciar/detener tienda local, cambiar rol, cargar juegos (local u online), subir a GitHub, correr tests, guardar URL de Neon (`.neon-url`, ignorado por git).
- Probado en Linux (Xvfb): cambiar rol y cargar juegos contra Postgres real. Los .bat anteriores siguen funcionando.

## Despliegue (preparado, sin publicar)
- La API sirve la tienda web en producción (`WEB_DIST_DIR`, `@fastify/static`), con fallback de rutas de la SPA.
- `start:prod`: aplica migraciones y arranca (sin `.env`).
- Correo real con Brevo (`MAIL_PROVIDER=brevo`); un fallo de envío no rompe el registro.
- `render.yaml` (Blueprint), `docs/DEPLOY.md`, `subir-a-github.bat`.
- Probado local en modo producción: health, tienda, rutas profundas, API, 404 JSON, migraciones automáticas. 34/34 tests.

## Pendiente
- Publicar: crear Neon + Brevo + repo privado + Blueprint en Render (pasos en `docs/DEPLOY.md`).
- Etapa 5: verificar en Windows y publicar. Subida de versiones (archivos) en Etapa 6 con R2. Precio > 0 se puede cargar pero no se puede comprar hasta Etapa 8.
- Comunidad: verificar en Windows (`iniciar.bat`) y publicar con `subir-a-github.bat` (Render migra solo).
- Comunidad: asignar moderadores con `cambiar-rol.bat` (local u online; `pnpm user:role <usuario> <rol>`) hasta el panel admin (Etapa 9). Sin avatares (requiere almacenamiento R2); sin notificaciones de amistad/respuestas (launcher/Android).
- Biblioteca: versiones instaladas y estado de descarga → requieren el launcher (Etapa 6).
- Home: populares, promociones, patrocinados y recomendaciones (requieren estadísticas/etapa 9).
- Adquisición y biblioteca (Etapa 4).
- Proveedor de correo real (hoy los correos solo se registran en el log).
- Pantallas de registro/login: se hacen con la tienda web (Etapa 3).
- Tienda web, launcher y Android: se crean en sus etapas.
