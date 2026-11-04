@echo off
cd /d "%~dp0"
rem Orden de carpetas (una sola vez): los .bat viejos de la raiz ya estan en "bat" y juegos.json va a "carga".
for %%f in (iniciar cargar-juegos cargar-juegos-online subir-a-github cambiar-rol) do if exist "%%f.bat" if exist "bat\%%f.bat" del "%%f.bat"
if exist "juegos.json" if not exist "carga\juegos.json" (
  if not exist "carga" mkdir "carga"
  move /y "juegos.json" "carga\juegos.json" >nul
)
where pythonw >nul 2>&1 && (start "" pythonw "herramientas\panel.pyw" & exit /b 0)
where pyw >nul 2>&1 && (start "" pyw "herramientas\panel.pyw" & exit /b 0)
echo No se encontró Python. Instalalo desde https://www.python.org (marcá "Add to PATH").
pause
