@echo off
chcp 65001 >nul
echo 🚀 Начинаем деплой Nano Banana на Railway...
echo.

REM Проверка Git
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Git не установлен. Установите Git: https://git-scm.com/downloads
    pause
    exit /b 1
)

REM Инициализация Git
if not exist ".git" (
    echo 📦 Инициализация Git репозитория...
    git init
    git add .
    git commit -m "Initial commit: Nano Banana project"
    echo ✅ Git репозиторий создан
)

echo.
echo ======================================
echo 📋 СЛЕДУЮЩИЕ ШАГИ:
echo ======================================
echo.
echo 1. Создайте репозиторий на GitHub:
echo    https://github.com/new
echo.
echo 2. Выполните эти команды:
echo    git remote add origin https://github.com/ВАШ_USERNAME/nano-banana.git
echo    git branch -M main
echo    git push -u origin main
echo.
echo 3. Откройте Railway:
echo    https://railway.app/new
echo.
echo 4. Нажмите 'Deploy from GitHub repo'
echo.
echo 5. Выберите репозиторий 'nano-banana'
echo.
echo 6. Добавьте переменные окружения в Railway:
echo    TELEGRAM_BOT_TOKEN=8526959887:AAF7bdIE1R-VUwmb7UEG8V3mUK43HDCdXyM
echo    GEMINI_API_KEY=AIzaSyC0HQoaMkFW9slsVtCAsNtZdio3uSUUPcI
echo    NODE_ENV=production
echo    PORT=3000
echo    FREE_TOKENS=100
echo    TOKENS_PER_STAR=1000
echo.
echo 7. Готово! 🎉
echo.
echo ======================================
echo.
pause

