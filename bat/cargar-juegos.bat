@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set DATABASE_URL=
echo === Cargando juegos en la tienda ===
call pnpm catalog:import carga\juegos.json
echo.
echo Si dice "Creado" o "Actualizado", recarga la tienda en el navegador.
pause
