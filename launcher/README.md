# AlphaShook Launcher (Windows y Linux)

Electron + React. Usa la misma cuenta y API que la tienda (`https://alphashook.onrender.com`, se cambia en Ajustes).

- Probar: Panel AlphaShook → pestaña **Launcher** → "Abrir launcher" (o `npm install && npm start`).
- Instalador Windows: Panel → "Crear instalador" o `bat\crear-launcher.bat` → `launcher\release\AlphaShook-Launcher-Setup-x.y.z.exe`.
- Linux: `npm run dist:linux` → AppImage y .deb.
- Tests del núcleo (descargas, integridad, instalación): `npm test`.

Estructura: `electron/` (proceso principal: API, descargas, instalación), `renderer/` (interfaz), `test/`.
Datos locales: carpeta de usuario de la app (`launcher.json`, `downloads.json`, `session.bin` cifrado, `descargas/*.part`).
