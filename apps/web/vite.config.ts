import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo, /v1 se redirige a la API: mismo origen, así la cookie de sesión funciona sin CORS.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/v1": "http://127.0.0.1:3000" } },
  preview: { port: 4173, proxy: { "/v1": "http://127.0.0.1:3000" } },
});
