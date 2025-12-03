require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { knex, userQueries, transactionQueries, generationQueries, contentQueries } = require('./database-postgres');
const GeminiService = require('./gemini-service');
const YookassaService = require('./yookassa-service');

// Инициализация
const app = express();
const PORT = process.env.PORT || 3000;
const gemini = new GeminiService(process.env.GEMINI_API_KEY);
const yookassa = new YookassaService(process.env.YOOKASSA_SHOP_ID, process.env.YOOKASSA_SECRET_KEY);

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
app.post('/api/auth', async (req, res) => {
  try {
    let { webId } = req.body;

    if (!webId) {
      webId = uuidv4();
    }

    const freeTokens = parseInt(process.env.FREE_TOKENS) || 100;
    const user = await userQueries.getOrCreateWebUser(webId, freeTokens);

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
app.get('/api/balance/:webId', async (req, res) => {
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
    const user = await userQueries.getByWebId(webId);
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
    await userQueries.updateCredits(-result.tokensUsed, user.id);

    // Сохраняем генерацию
    await generationQueries.create(user.id, prompt, result.text, result.tokensUsed);

    // Сохраняем транзакцию
    await transactionQueries.create(
      user.id,
      'generation',
      -result.tokensUsed,
      0,
      'Генерация текста'
    );

    // Обновляем статистику генераций
    await userQueries.incrementGenerations(result.tokensUsed, user.id);

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
app.get('/api/history/:webId', async (req, res) => {
  try {
    const user = await userQueries.getByWebId(req.params.webId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const limit = parseInt(req.query.limit) || 10;
    const history = await generationQueries.getHistory(user.id, limit);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// История транзакций
app.get('/api/transactions/:webId', async (req, res) => {
  try {
    const user = await userQueries.getByWebId(req.params.webId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const transactions = await transactionQueries.getHistory(user.id, limit);

    res.json({
      success: true,
      transactions
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==================== TELEGRAM BOT ====================
// Запускаем бота только если есть токен (MUST BE BEFORE WEBHOOKS)
let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  telegramBot = require('./telegram-bot');
  console.log('🤖 Telegram бот запущен');
} else {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN не найден, бот не запущен');
}

// Webhook для ЮKassa
app.post('/yookassa/webhook', async (req, res) => {
  try {
    const { event, object } = req.body;

    if (event === 'payment.succeeded') {
      const paymentId = object.id;
      const metadata = object.metadata || {};
      const userId = metadata.userId;
      const amount = parseFloat(object.amount.value);

      console.log(`💰 ЮKassa: Успешный платеж ${paymentId} на сумму ${amount} RUB от пользователя ${userId}`);

      if (userId) {
        // Получаем количество кредитов из метаданных или считаем по базовому тарифу
        let creditsToAdd = 0;

        if (metadata.credits) {
          creditsToAdd = parseInt(metadata.credits);
        } else {
          // Fallback: считаем по самому дорогому тарифу (100р = 35 кр)
          // 1 RUB = 0.35 credits
          creditsToAdd = Math.floor(amount * 0.35);
        }

        // Получаем пользователя для проверки существования
        const user = await userQueries.getAdminUserById(userId);

        if (user) {
          await userQueries.updateCredits(creditsToAdd, userId);

          await transactionQueries.create(
            userId,
            'purchase_yookassa',
            creditsToAdd,
            amount,
            `Покупка через ЮKassa (${amount} RUB)`
          );

          // Уведомляем пользователя через бота
          if (telegramBot && user.telegram_id) {
            try {
              await telegramBot.sendMessage(
                user.telegram_id,
                `✅ Оплата прошла успешно!\n\n💰 Сумма: ${amount} RUB\n💎 Начислено: ${creditsToAdd} кредитов\n\nСпасибо за покупку!`
              );
            } catch (e) {
              console.error('Ошибка отправки уведомления об оплате:', e.message);
            }
          }
        }
      }
    } else if (event === 'payment.canceled') {
      const metadata = object.metadata || {};
      const userId = metadata.userId;

      console.log(`❌ ЮKassa: Платеж отменен/не удался для пользователя ${userId}`);

      if (userId) {
        const user = await userQueries.getAdminUserById(userId);
        if (telegramBot && user && user.telegram_id) {
          try {
            await telegramBot.sendMessage(
              user.telegram_id,
              `❌ Оплата не прошла или была отменена.\n\nЕсли деньги списались, они вернутся автоматически. Попробуйте снова или выберите другой способ оплаты.`
            );
          } catch (e) {
            console.error('Ошибка отправки уведомления об отмене:', e.message);
          }
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка вебхука ЮKassa:', error);
    res.status(500).send('Error');
  }
});


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

// Пересчитать статистику (для исправления старых данных)
app.post('/api/admin/recalculate-stats', requireAdmin, async (req, res) => {
  try {
    console.log('🔄 Админ запустил пересчет статистики...');

    // 1. Сбрасываем текущую статистику
    await knex('users').update({
      generations_count: 0,
      total_spent_credits: 0
    });

    // 2. Получаем всех пользователей
    const users = await knex('users').select('id');
    let updatedCount = 0;

    for (const user of users) {
      // 3. Считаем реальные генерации
      const stats = await knex('generations')
        .select(
          knex.raw('COUNT(*) as count'),
          knex.raw('SUM(cost) as total_cost')
        )
        .where('user_id', user.id)
        .first();

      const count = parseInt(stats.count) || 0;
      const totalCost = parseInt(stats.total_cost) || 0;

      if (count > 0) {
        // 4. Обновляем пользователя
        await knex('users')
          .where('id', user.id)
          .update({
            generations_count: count,
            total_spent_credits: totalCost
          });
        updatedCount++;
      }
    }

    console.log(`✅ Пересчет завершен! Обновлено пользователей: ${updatedCount}`);

    res.json({
      success: true,
      message: `Статистика пересчитана. Обновлено пользователей: ${updatedCount}`
    });
  } catch (error) {
    console.error('Ошибка пересчета статистики:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить общую статистику
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await userQueries.getTotalStats();
    const transactionStats = await transactionQueries.getTotalStats();
    const generationStats = await generationQueries.countByType();

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
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await userQueries.getAllUsers();

    // Добавляем информацию о рефералах для каждого пользователя
    // Оптимизация: лучше делать это одним запросом, но пока оставим так, но с await
    const usersWithRefs = await Promise.all(users.map(async user => {
      const refCount = await userQueries.countReferrals(user.id);
      return {
        ...user,
        referrals_count: refCount.count || 0
      };
    }));

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
app.get('/api/admin/user/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const user = await userQueries.getAdminUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    // Получаем генерации
    const generations = await generationQueries.getAllByUserId(userId);

    // Получаем транзакции
    const transactions = await transactionQueries.getAllByUserId(userId);

    // Получаем рефералов
    const referrals = await userQueries.getReferrals(userId);

    res.json({
      success: true,
      user: {
        user,
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
app.get('/api/admin/requests', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    const requests = await userQueries.getRequests(limit);

    res.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('Ошибка получения запросов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить изображение генерации (lazy load)
app.get('/api/admin/generation/:id/image', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const generation = await generationQueries.getGenerationImage(id);

    if (!generation || !generation.image_data) {
      return res.status(404).json({ success: false, error: 'Изображение не найдено' });
    }

    res.json({
      success: true,
      image_data: generation.image_data
    });
  } catch (error) {
    console.error('Ошибка получения изображения:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Начислить кредиты пользователю
app.post('/api/admin/add-credits', requireAdmin, async (req, res) => {
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
    const user = await userQueries.getAdminUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    // Начисляем кредиты
    await userQueries.updateCredits(creditsAmount, userId);

    // Сохраняем транзакцию
    const txDescription = description || `Админ начислил ${creditsAmount > 0 ? '+' : ''}${creditsAmount} кредитов`;
    await transactionQueries.create(
      userId,
      'admin_add',
      creditsAmount,
      0,
      txDescription
    );

    // Получаем обновленного пользователя
    const updatedUser = await userQueries.getAdminUserById(userId);

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
    const user = await userQueries.getAdminUserById(userId);
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

// Массовая рассылка сообщений
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    const { message, filters } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Требуется message' });
    }

    // Проверяем, что бот доступен
    if (!telegramBot) {
      return res.status(503).json({ success: false, error: 'Telegram бот не инициализирован' });
    }

    // Получаем список пользователей
    const users = await userQueries.getUsersForBroadcast(filters);

    if (users.length === 0) {
      return res.status(400).json({ success: false, error: 'Нет пользователей, соответствующих фильтрам' });
    }

    // Отправляем сообщения асинхронно с задержкой между запросами (чтобы не превысить лимиты Telegram)
    const results = {
      total: users.length,
      sent: 0,
      failed: 0,
      errors: []
    };

    // Отправляем сообщения с задержкой 50ms между запросами (20 сообщений в секунду)
    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      try {
        const chatId = parseInt(user.telegram_id);
        await telegramBot.sendMessage(chatId, message);
        results.sent++;

        // Небольшая задержка между сообщениями
        if (i < users.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          userId: user.id,
          username: user.username || user.telegram_id,
          error: error.message || 'Неизвестная ошибка'
        });

        // Логируем ошибки, но продолжаем рассылку
        console.error(`❌ Ошибка отправки пользователю ${user.username || user.telegram_id}:`, error.message);
      }
    }

    console.log(`📢 Массовая рассылка завершена: ${results.sent}/${results.total} отправлено`);

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Ошибка массовой рассылки:', error);
    res.status(500).json({ success: false, error: error.message || 'Ошибка массовой рассылки' });
  }
});

// ==================== УПРАВЛЕНИЕ КОНТЕНТОМ ====================

// Получить весь контент (для админ-панели)
app.get('/api/admin/content', requireAdmin, async (req, res) => {
  try {
    const content = await contentQueries.getAll();
    res.json({
      success: true,
      content
    });
  } catch (error) {
    console.error('Ошибка получения контента:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить контент по типу
app.get('/api/admin/content/:type', requireAdmin, async (req, res) => {
  try {
    const { type } = req.params;
    const content = await contentQueries.getAllByType(type);
    res.json({
      success: true,
      content
    });
  } catch (error) {
    console.error('Ошибка получения контента:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Создать или обновить контент
app.post('/api/admin/content', requireAdmin, async (req, res) => {
  try {
    const { id, type, title, text, image_data, order_index, is_active } = req.body;

    if (!type) {
      return res.status(400).json({ success: false, error: 'Требуется type' });
    }

    if (id) {
      // Обновление существующего контента
      const updated = await contentQueries.update(
        title || null,
        text || null,
        image_data || null,
        order_index || 0,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        id
      );

      res.json({
        success: true,
        message: 'Контент обновлен',
        content: updated
      });
    } else {
      // Создание нового контента
      const created = await contentQueries.create(
        type,
        title || null,
        text || null,
        image_data || null,
        order_index || 0,
        is_active !== undefined ? (is_active ? 1 : 0) : 1
      );

      res.json({
        success: true,
        message: 'Контент создан',
        content: created
      });
    }
  } catch (error) {
    console.error('Ошибка сохранения контента:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Удалить контент
app.delete('/api/admin/content/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await contentQueries.delete(id);
    res.json({
      success: true,
      message: 'Контент удален'
    });
  } catch (error) {
    console.error('Ошибка удаления контента:', error);
    res.status(500).json({ success: false, error: error.message });
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

