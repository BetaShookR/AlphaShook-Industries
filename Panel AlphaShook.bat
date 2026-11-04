@echo off
cd /d "%~dp0"
where pythonw >nul 2>&1 && (start "" pythonw "herramientas\panel.pyw" & exit /b 0)
where pyw >nul 2>&1 && (start "" pyw "herramientas\panel.pyw" & exit /b 0)
echo No se encontró Python. Instalalo desde https://www.python.org (marcá "Add to PATH").
pause
