@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
echo === Cambiar rol de un usuario (moderador, admin, etc.) ===
echo.
echo  1 = Base LOCAL (tu PC)
echo  2 = Base ONLINE (Neon, la de la tienda publicada)
set /p DONDE=Elegí 1 o 2: 
set DATABASE_URL=
if "%DONDE%"=="2" (
  set /p DATABASE_URL=Pegá la URL de Neon (postgresql://...): 
)
set /p USUARIO=Nombre de usuario: 
echo Roles: user, developer, moderator, admin
set /p ROL=Rol nuevo: 
call pnpm --silent user:role "%USUARIO%" "%ROL%"
set DATABASE_URL=
echo.
pause
endlocal
