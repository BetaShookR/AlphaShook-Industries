import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La interfaz se carga con file:// desde Electron → rutas relativas.
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
