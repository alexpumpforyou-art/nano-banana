require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { db, userQueries, transactionQueries, generationQueries } = require('./database');
const GeminiService = require('./gemini-service');

// Инициализация
const app = express();
const PORT = process.env.PORT || 3000;
const gemini = new GeminiService(process.env.GEMINI_API_KEY);

// Простая система сессий для админ-панели
const adminSessions = new Map(); // sessionId -> { timestamp, ip }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 часа

// Middleware
app.set('trust proxy', true); // Для получения реального IP в Railway
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
let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  telegramBot = require('./telegram-bot');
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

// ==================== АДМИН-ПАНЕЛЬ ====================

// Middleware для проверки админ-сессии
function requireAdmin(req, res, next) {
  const sessionId = req.headers['x-admin-session'] || req.query.session;
  
  if (!sessionId) {
    return res.status(401).json({ success: false, error: 'Требуется авторизация' });
  }
  
  const session = adminSessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Сессия истекла' });
  }
  
  // Проверяем таймаут
  if (Date.now() - session.timestamp > SESSION_TIMEOUT) {
    adminSessions.delete(sessionId);
    return res.status(401).json({ success: false, error: 'Сессия истекла' });
  }
  
  // Обновляем время последней активности
  session.timestamp = Date.now();
  next();
}

// Очистка старых сессий каждые 10 минут
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of adminSessions.entries()) {
    if (now - session.timestamp > SESSION_TIMEOUT) {
      adminSessions.delete(sessionId);
    }
  }
}, 10 * 60 * 1000);

// Вход в админ-панель
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Неверный пароль' });
    }
    
    // Создаем сессию
    const sessionId = uuidv4();
    adminSessions.set(sessionId, {
      timestamp: Date.now(),
      ip: req.ip || req.connection.remoteAddress
    });
    
    res.json({
      success: true,
      sessionId
    });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить общую статистику
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const stats = userQueries.getTotalStats.get();
    const transactionStats = transactionQueries.getTotalStats.get();
    const generationStats = generationQueries.countByType.all();
    
    res.json({
      success: true,
      stats: {
        users: stats || {},
        transactions: transactionStats || {},
        generations: generationStats || []
      }
    });
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить всех пользователей
app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const users = userQueries.getAllUsers.all();
    
    // Добавляем информацию о рефералах для каждого пользователя
    const usersWithRefs = users.map(user => {
      const refCount = userQueries.countReferrals.get(user.id)?.count || 0;
      return {
        ...user,
        referrals_count: refCount
      };
    });
    
    res.json({
      success: true,
      users: usersWithRefs
    });
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить детальную информацию о пользователе
app.get('/api/admin/user/:id', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    const user = userQueries.getAdminUserById.get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    
    // Получаем генерации
    const generations = generationQueries.getAllByUserId.all(userId);
    
    // Получаем транзакции
    const transactions = transactionQueries.getAllByUserId.all(userId);
    
    // Получаем рефералов
    const referrals = userQueries.getReferrals.all(userId);
    
    res.json({
      success: true,
      user: {
        ...user,
        generations,
        transactions,
        referrals
      }
    });
  } catch (error) {
    console.error('Ошибка получения пользователя:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить все запросы пользователей (для админ-панели)
app.get('/api/admin/requests', requireAdmin, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    const requests = db.prepare(`
      SELECT 
        g.id,
        g.prompt,
        g.response,
        g.credits_used,
        g.type,
        g.image_data,
        g.created_at,
        u.id as user_id,
        u.username,
        u.telegram_id,
        u.web_id
      FROM generations g
      JOIN users u ON g.user_id = u.id
      ORDER BY g.created_at DESC
      LIMIT ?
    `).all(limit);
    
    res.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('Ошибка получения запросов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Начислить кредиты пользователю
app.post('/api/admin/add-credits', requireAdmin, (req, res) => {
  try {
    const { userId, credits, description } = req.body;
    
    if (!userId || credits === undefined || credits === null) {
      return res.status(400).json({ success: false, error: 'Требуется userId и credits' });
    }
    
    const creditsAmount = parseInt(credits);
    if (isNaN(creditsAmount) || creditsAmount === 0) {
      return res.status(400).json({ success: false, error: 'Кредиты должны быть числом, не равным нулю' });
    }
    
    // Получаем пользователя
    const user = userQueries.getAdminUserById.get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    
    // Начисляем кредиты
    userQueries.updateCredits.run(creditsAmount, userId);
    
    // Сохраняем транзакцию
    const txDescription = description || `Админ начислил ${creditsAmount > 0 ? '+' : ''}${creditsAmount} кредитов`;
    transactionQueries.create.run(
      userId,
      'admin_add',
      creditsAmount,
      0,
      txDescription
    );
    
    // Получаем обновленного пользователя
    const updatedUser = userQueries.getAdminUserById.get(userId);
    
    console.log(`💰 Админ начислил ${creditsAmount} кредитов пользователю ${user.username || user.telegram_id || user.id}`);
    
    res.json({
      success: true,
      message: `Начислено ${creditsAmount > 0 ? '+' : ''}${creditsAmount} кредитов`,
      user: {
        id: updatedUser.id,
        credits: updatedUser.credits
      }
    });
  } catch (error) {
    console.error('Ошибка начисления кредитов:', error);
    res.status(500).json({ success: false, error: error.message || 'Ошибка начисления кредитов' });
  }
});

// Отправить сообщение пользователю через Telegram бота
app.post('/api/admin/send-message', requireAdmin, async (req, res) => {
  try {
    const { userId, message } = req.body;
    
    if (!userId || !message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Требуется userId и message' });
    }
    
    // Получаем пользователя
    const user = userQueries.getAdminUserById.get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    
    // Проверяем, что у пользователя есть Telegram ID
    if (!user.telegram_id) {
      return res.status(400).json({ success: false, error: 'У пользователя нет Telegram ID (это Web пользователь)' });
    }
    
    // Проверяем, что бот доступен
    if (!telegramBot) {
      return res.status(503).json({ success: false, error: 'Telegram бот не инициализирован' });
    }
    
    // Отправляем сообщение
    const chatId = parseInt(user.telegram_id);
    await telegramBot.sendMessage(chatId, message);
    
    console.log(`📤 Админ отправил сообщение пользователю ${user.username || user.telegram_id}: ${message.substring(0, 50)}...`);
    
    res.json({
      success: true,
      message: 'Сообщение отправлено успешно'
    });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    
    // Обрабатываем специфичные ошибки Telegram
    if (error.response && error.response.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Пользователь заблокировал бота или не может получать сообщения' });
    }
    
    res.status(500).json({ success: false, error: error.message || 'Ошибка отправки сообщения' });
  }
});

// Роут для HTML страницы админ-панели
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Диагностический endpoint - показывает доступные модели
app.get('/api/debug/models', async (req, res) => {
  try {
    const https = require('https');
    const apiKey = process.env.GEMINI_API_KEY;
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    // Используем https.get вместо fetch
    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    
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

