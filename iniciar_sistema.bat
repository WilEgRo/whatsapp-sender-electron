@echo off
echo ==========================================
echo 🍅 INICIANDO SISTEMA BOT LA MARTINA 🍅
echo ==========================================

:: 1. IR AL Frontend (M:\whatsapp-sender-electron)
:: Usamos /d para asegurar que cambie de unidad correctamente
cd /d "M:\whatsapp-sender-electron"
echo Iniciando Electron...
start "Frontend electron" cmd /k "npm start"

:: Esperar 4 segundos a que Vite arranque
timeout /t 4 /nobreak >nul

echo.
echo ¡Sistema corriendo! Minimiza la ventana negra.
pause