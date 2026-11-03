# AlphaShook

Ecosistema de distribución digital de AlphaShook Corporation. Estado: ver `PROJECT_STATUS.md`. Decisiones: `docs/DECISIONS.md`.

## Puesta en marcha (Windows)

Requisitos: Node 24, PostgreSQL 17, pnpm (`corepack enable pnpm`).

```powershell
# 1. Base de datos (psql como usuario postgres)
psql -U postgres -c "CREATE USER alphashook WITH PASSWORD 'alphashook' CREATEDB;"
psql -U postgres -c "CREATE DATABASE alphashook OWNER alphashook;"

# 2. Proyecto
pnpm install
copy apps\api\.env.example apps\api\.env
pnpm build
pnpm db:migrate
pnpm test
pnpm dev        # API en http://127.0.0.1:3000/health
```
