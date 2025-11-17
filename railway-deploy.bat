@echo off
chcp 65001 >nul
cls
echo.
echo ╔═══════════════════════════════════════════╗
echo ║   🚂 Автоматический деплой на Railway     ║
echo ╚═══════════════════════════════════════════╝
echo.

REM Проверка Git
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Git не установлен
    echo 📥 Скачайте: https://git-scm.com/downloads
    pause
    exit /b 1
)

echo ✅ Git установлен
echo.

REM Проверка Railway CLI
railway --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Railway CLI не установлен
    echo 📥 Устанавливаю Railway CLI...
    call npm install -g @railway/cli
)

echo ✅ Railway CLI установлен
echo.

echo ═══════════════════════════════════════════
echo   Шаг 1: Инициализация Git
echo ═══════════════════════════════════════════
echo.

if not exist ".git" (
    echo 📦 Создаю Git репозиторий...
    git init
    git add .
    git commit -m "Initial commit: Nano Banana"
    echo ✅ Git репозиторий создан
) else (
    echo ✅ Git репозиторий уже существует
)

echo.
echo ═══════════════════════════════════════════
echo   Шаг 2: Авторизация в Railway
echo ═══════════════════════════════════════════
echo.
echo 🔑 Сейчас откроется браузер для авторизации...
echo.
pause

railway login

echo.
echo ═══════════════════════════════════════════
echo   Шаг 3: Создание проекта на Railway
echo ═══════════════════════════════════════════
echo.

railway init

echo.
echo ═══════════════════════════════════════════
echo   Шаг 4: Загрузка кода
echo ═══════════════════════════════════════════
echo.

railway up

echo.
echo ═══════════════════════════════════════════
echo   Шаг 5: Настройка переменных окружения
echo ═══════════════════════════════════════════
echo.

railway variables set TELEGRAM_BOT_TOKEN=8526959887:AAF7bdIE1R-VUwmb7UEG8V3mUK43HDCdXyM
railway variables set GEMINI_API_KEY=AIzaSyC0HQoaMkFW9slsVtCAsNtZdio3uSUUPcI
railway variables set NODE_ENV=production
railway variables set PORT=3000
railway variables set FREE_TOKENS=100
railway variables set TOKENS_PER_STAR=1000

echo.
echo ═══════════════════════════════════════════
echo   Шаг 6: Генерация домена
echo ═══════════════════════════════════════════
echo.

railway domain

echo.
echo ═══════════════════════════════════════════
echo   🎉 ДЕПЛОЙ ЗАВЕРШЁН!
echo ═══════════════════════════════════════════
echo.
echo ✅ Ваш проект задеплоен на Railway!
echo.
echo 📊 Полезные команды:
echo    railway logs       - посмотреть логи
echo    railway open       - открыть в браузере
echo    railway status     - статус проекта
echo.
echo 🌐 Откройте Railway Dashboard:
railway open

pause

