# 🚀 Быстрый деплой на Railway (3 минуты)

## Шаг 1: Создайте GitHub репозиторий

1. Откройте: https://github.com/new
2. Название: `nano-banana`
3. Приватность: Public или Private (не важно)
4. НЕ СОЗДАВАЙТЕ README
5. Нажмите "Create repository"

## Шаг 2: Загрузите код (скопируйте эти команды)

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ВАШ_USERNAME/nano-banana.git
git push -u origin main
```

⚠️ Замените `ВАШ_USERNAME` на ваш GitHub username!

## Шаг 3: Деплой на Railway

1. Откройте: https://railway.app/new
2. Нажмите: **"Deploy from GitHub repo"**
3. Выберите репозиторий: `nano-banana`
4. Railway автоматически начнёт деплой!

## Шаг 4: Добавьте переменные окружения

1. В Railway нажмите на ваш сервис
2. Перейдите в **Variables**
3. Нажмите **"Add Variable"** и добавьте:

```
TELEGRAM_BOT_TOKEN = 8526959887:AAF7bdIE1R-VUwmb7UEG8V3mUK43HDCdXyM
GEMINI_API_KEY = AIzaSyC0HQoaMkFW9slsVtCAsNtZdio3uSUUPcI
NODE_ENV = production
PORT = 3000
FREE_TOKENS = 100
TOKENS_PER_STAR = 1000
```

4. Нажмите **"Deploy"** (Railway автоматически передеплоит)

## Шаг 5: Получите URL

1. В Railway перейдите в **Settings**
2. Раздел **Networking**
3. Нажмите **"Generate Domain"**
4. Скопируйте URL (например: `nano-banana-production.up.railway.app`)

## ✅ Готово!

Откройте ваш URL в браузере - сайт работает!
Найдите бота в Telegram и отправьте `/start`

---

# 🎯 Альтернатива: Без GitHub (через Railway CLI)

Если не хотите использовать GitHub:

1. Откройте Railway Dashboard: https://railway.app/dashboard
2. Нажмите **"New Project"**
3. Выберите **"Empty Project"**
4. Нажмите **"+ New"** → **"Empty Service"**
5. В сервисе перейдите в **Settings** → **Source**
6. Нажмите **"Connect Repo"** и подключите GitHub

Или создайте проект вручную через веб-интерфейс и загрузите ZIP файл.

