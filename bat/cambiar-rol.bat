@echo off
chcp 65001 >nul
cd /d "%~dp0.."
setlocal EnableDelayedExpansion
set "DATABASE_URL="
cls
echo ============================================
echo     CAMBIAR ROL DE UN USUARIO - AlphaShook
echo ============================================
echo.
echo  ¿Dónde está el usuario?
echo    1 = En la tienda ONLINE (alphashook.onrender.com)
echo    2 = En mi PC (tienda de prueba)
echo.
set /p "DONDE=Escribí 1 o 2 y apretá Enter: "
if "!DONDE!"=="1" goto :online
if "!DONDE!"=="2" goto :usuario
echo Opción inválida.& goto :fin

:online
if exist ".neon-url" (
  set /p "DATABASE_URL="<".neon-url"
  echo  Usando la base online guardada.
) else (
  echo.
  echo  Solo esta vez: pegá la URL de Neon ^(empieza con postgresql://^)
  echo  ^(clic derecho para pegar^). Queda guardada en tu PC, no se sube a GitHub.
  set /p "DATABASE_URL=URL: "
  if "!DATABASE_URL!"=="" echo No pegaste nada.& goto :fin
  (echo(!DATABASE_URL!)>".neon-url"
)

:usuario
echo.
set /p "USUARIO=Nombre de usuario (como aparece en la tienda): "
if "!USUARIO!"=="" echo No escribiste el usuario.& goto :fin
echo.
echo  ¿Qué rol le das?
echo    1 = Moderador      (puede ocultar reseñas y mensajes, cerrar temas)
echo    2 = Administrador  (todo lo anterior + panel admin en el futuro)
echo    3 = Desarrollador  (para el portal de desarrolladores)
echo    4 = Usuario normal (quitar permisos)
echo.
set /p "OPC=Escribí 1, 2, 3 o 4: "
set "ROL="
if "!OPC!"=="1" set "ROL=moderator"
if "!OPC!"=="2" set "ROL=admin"
if "!OPC!"=="3" set "ROL=developer"
if "!OPC!"=="4" set "ROL=user"
if "!ROL!"=="" echo Opción inválida.& goto :fin
echo.
call pnpm --silent user:role "!USUARIO!" "!ROL!"
echo.
echo  Si el usuario tenía la tienda abierta, que recargue la página (F5).

:fin
echo.
pause
endlocal
