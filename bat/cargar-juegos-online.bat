@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo Carga los juegos de carga\juegos.json en la tienda ONLINE (Neon).
echo.
set /p DATABASE_URL=Pega la connection string de Neon (clic derecho pega) y Enter: 
call pnpm catalog:import carga\juegos.json
set DATABASE_URL=
echo.
echo Si dice "Creado" o "Actualizado", recarga la tienda online.
pause
