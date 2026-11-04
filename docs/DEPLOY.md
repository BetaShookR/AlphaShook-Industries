# Despliegue en Render (gratis)

Arquitectura: **1 servicio web en Render** (API + tienda) + **PostgreSQL en Neon** + **correo con Brevo**.

## 1. Base de datos (Neon)
1. Crear cuenta en https://neon.tech → *New project* (región: AWS US East).
2. Copiar la **connection string** (empieza con `postgresql://` y termina con `?sslmode=require`). Es secreta.

## 2. Correo (Brevo)
1. Crear cuenta en https://www.brevo.com.
2. *Senders, Domains & Dedicated IPs* → *Senders* → agregar y verificar el correo remitente.
3. *SMTP & API* → *API Keys* → crear una clave. Es secreta.

## 3. Código en GitHub
1. Crear un repo **privado** vacío en GitHub (sin README).
2. Doble clic en `bat\subir-a-github.bat` y pegar la URL del repo.

## 4. Render
1. https://dashboard.render.com → *New* → *Blueprint* → elegir el repo. Render lee `render.yaml`.
2. Completar las variables secretas:
   - `DATABASE_URL`: la de Neon.
   - `PUBLIC_WEB_URL`: la URL del servicio (`https://alphashook-xxxx.onrender.com`). Se puede completar después del primer deploy.
   - `BREVO_API_KEY` y `MAIL_FROM_EMAIL`: los de Brevo.
3. *Apply*. Cada `git push` vuelve a desplegar solo; las migraciones se aplican al arrancar.

## Cargar productos en producción
En tu PC, con la `DATABASE_URL` de Neon:
```cmd
set DATABASE_URL=postgresql://...neon...
pnpm catalog:import carga\juegos.json
set DATABASE_URL=
```

## Límites del plan gratis
- El servicio se duerme tras 15 min sin visitas (la primera carga tarda ~1 min).
- 750 h/mes compartidas entre todos los servicios gratis de la cuenta (incluido el servidor de FTW).
