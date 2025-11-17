require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { userQueries, transactionQueries, generationQueries } = require('./database');
const GeminiService = require('./gemini-service');

// Инициализация
const app = express();
const PORT = process.env.PORT || 3000;
const gemini = new GeminiService(process.env.GEMINI_API_KEY);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ==================== WEB API ====================

// Получить или создать веб-пользователя
app.post('/api/auth', (req, res) => {
  try {
    let { webId } = req.body;
    
    if (!webId) {
      webId = uuidv4();
    }

    const freeTokens = parseInt(process.env.FREE_TOKENS) || 100;
    const user = userQueries.getOrCreateWebUser.get(webId, freeTokens);

    res.json({
      success: true,
      user: {
        id: user.id,
        webId: user.web_id,
        tokens: user.tokens
      }
    });
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить баланс пользователя
app.get('/api/balance/:webId', (req, res) => {
  try {
    const user = userQueries.getByWebId.get(req.params.webId);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    res.json({
      success: true,
      tokens: user.tokens
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Генерация через Gemini
app.post('/api/generate', async (req, res) => {
  try {
    const { webId, prompt } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Пустой запрос' });
    }

    // Получаем пользователя
    const user = userQueries.getByWebId.get(webId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    // Проверяем баланс
    if (user.tokens <= 0) {
      return res.status(403).json({ 
        success: false, 
        error: 'Недостаточно токенов. Купите токены для продолжения.',
        needTokens: true
      });
    }

    // Генерируем ответ
    const result = await gemini.generate(prompt);

    // Проверяем, хватит ли токенов
    if (user.tokens < result.tokensUsed) {
      return res.status(403).json({ 
        success: false, 
        error: `Недостаточно токенов. Требуется: ${result.tokensUsed}, доступно: ${user.tokens}`,
        needTokens: true
      });
    }

    // Списываем токены
    userQueries.updateTokens.run(-result.tokensUsed, user.id);

    // Сохраняем генерацию
    generationQueries.create.run(user.id, prompt, result.text, result.tokensUsed);

    // Сохраняем транзакцию
    transactionQueries.create.run(
      user.id,
      'generation',
      -result.tokensUsed,
      0,
      'Генерация текста'
    );

    res.json({
      success: true,
      response: result.text,
      tokensUsed: result.tokensUsed,
      tokensRemaining: user.tokens - result.tokensUsed
    });

  } catch (error) {
    console.error('Ошибка генерации:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// История генераций
app.get('/api/history/:webId', (req, res) => {
  try {
    const user = userQueries.getByWebId.get(req.params.webId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const limit = parseInt(req.query.limit) || 10;
    const history = generationQueries.getHistory.all(user.id, limit);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// История транзакций
app.get('/api/transactions/:webId', (req, res) => {
  try {
    const user = userQueries.getByWebId.get(req.params.webId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const transactions = transactionQueries.getHistory.all(user.id, limit);

    res.json({
      success: true,
      transactions
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TELEGRAM BOT ====================
// Запускаем бота только если есть токен
if (process.env.TELEGRAM_BOT_TOKEN) {
  require('./telegram-bot');
  console.log('🤖 Telegram бот запущен');
} else {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN не найден, бот не запущен');
}

// ==================== СЕРВЕР ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Диагностический endpoint - показывает доступные модели
app.get('/api/debug/models', async (req, res) => {
  try {
    const fetch = require('node-fetch');
    const apiKey = process.env.GEMINI_API_KEY;
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      return res.json({ 
        error: data.error.message,
        apiKeyPreview: apiKey ? apiKey.substring(0, 20) + '...' : 'NOT SET'
      });
    }
    
    const workingModels = data.models
      ? data.models
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''))
      : [];
    
    res.json({
      success: true,
      totalModels: data.models?.length || 0,
      workingModels,
      recommendation: workingModels[0] || 'none',
      apiKeyPreview: apiKey ? apiKey.substring(0, 20) + '...' : 'NOT SET'
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🍌 Nano Banana Server                   ║
║   🌐 http://localhost:${PORT}              ║
║   ✅ Ready to serve!                      ║
╚═══════════════════════════════════════════╝
  `);
});

