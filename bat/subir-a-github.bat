@echo off
chcp 65001 >nul
cd /d "%~dp0.."
git remote get-url origin >nul 2>&1 && goto :push
set /p URL=Pega la URL del repo privado de GitHub (https://github.com/...): 
git remote add origin "%URL%" || goto :error
:push
git add -A || goto :error
git commit -m "Actualizacion AlphaShook" >nul 2>&1
git branch -M main
git push -u origin main || goto :error
echo.
echo Listo: codigo subido. Render lo despliega solo.
pause
exit /b 0
:error
echo *** Hubo un error. Copia el texto de arriba y pasaselo a Claude. ***
pause
exit /b 1
