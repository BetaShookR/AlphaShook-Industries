@echo off
chcp 65001 >nul
cd /d "%~dp0..\launcher"
echo === Creando el instalador del launcher para Windows (la primera vez tarda varios minutos) ===
call npm install --no-audit --no-fund || goto :error
call npm run dist:win || goto :error
echo.
echo Listo: el instalador esta en launcher\release
start "" "%cd%\release"
pause
exit /b 0
:error
echo *** Hubo un error. Copia el texto de arriba y pasaselo a Claude. ***
pause
exit /b 1
