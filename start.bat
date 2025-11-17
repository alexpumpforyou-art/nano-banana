@echo off
chcp 65001 >nul
cls
echo.
echo ╔═══════════════════════════════════════════╗
echo ║   🍌 Запуск Nano Banana Server            ║
echo ╚═══════════════════════════════════════════╝
echo.
echo 📦 Проверка зависимостей...

if not exist "node_modules" (
    echo ❌ node_modules не найдены
    echo 📥 Установка зависимостей...
    call npm install
)

echo.
echo 🔑 Проверка .env файла...
if not exist ".env" (
    echo ❌ .env файл не найден!
    echo ⚠️  Создайте .env файл с ключами API
    pause
    exit /b 1
)

echo ✅ .env найден
echo.
echo 🚀 Запуск сервера...
echo.
echo ╔═══════════════════════════════════════════╗
echo ║  Сервер запустится на http://localhost:3000 ║
echo ║  Нажмите Ctrl+C для остановки             ║
echo ╚═══════════════════════════════════════════╝
echo.

node server.js

pause

