@echo off
chcp 65001 >nul
cd /d "%~dp0"
set DATABASE_URL=
title AlphaShook - preparando
echo === Instalando dependencias ===
call pnpm install || goto :error
echo === Compilando ===
call pnpm build || goto :error
echo === Aplicando migraciones ===
call pnpm db:migrate || goto :error
echo === Iniciando API y tienda ===
start "AlphaShook API (no cerrar)" cmd /k "cd /d ""%~dp0"" && pnpm dev"
start "AlphaShook Tienda (no cerrar)" cmd /k "cd /d ""%~dp0"" && pnpm dev:web"
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
echo Listo. Para detener todo, cerrá las ventanas "AlphaShook API" y "AlphaShook Tienda".
pause
exit /b 0
:error
echo.
echo *** Hubo un error. Copiá el texto de arriba y pasáselo a Claude. ***
pause
exit /b 1
