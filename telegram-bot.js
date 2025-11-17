const TelegramBot = require('node-telegram-bot-api');
const { userQueries, transactionQueries, generationQueries } = require('./database');
const GeminiService = require('./gemini-service');
const ImageService = require('./image-service');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const gemini = new GeminiService(process.env.GEMINI_API_KEY);
const imageService = new ImageService(process.env.GEMINI_API_KEY);

const FREE_TOKENS = parseInt(process.env.FREE_TOKENS) || 100;
const TOKENS_PER_STAR = parseInt(process.env.TOKENS_PER_STAR) || 2000;

// Генерируем пакеты токенов динамически на основе TOKENS_PER_STAR
const TOKEN_PACKAGES = [
  { 
    stars: 1, 
    tokens: TOKENS_PER_STAR * 1, 
    label: `${TOKENS_PER_STAR} токенов`,
    description: 'Базовый пакет' 
  },
  { 
    stars: 5, 
    tokens: Math.floor(TOKENS_PER_STAR * 5 * 1.1), 
    label: `${Math.floor(TOKENS_PER_STAR * 5 * 1.1)} токенов`,
    description: '+10% бонус' 
  },
  { 
    stars: 10, 
    tokens: Math.floor(TOKENS_PER_STAR * 10 * 1.2), 
    label: `${Math.floor(TOKENS_PER_STAR * 10 * 1.2)} токенов`,
    description: '+20% бонус' 
  },
  { 
    stars: 25, 
    tokens: Math.floor(TOKENS_PER_STAR * 25 * 1.3), 
    label: `${Math.floor(TOKENS_PER_STAR * 25 * 1.3)} токенов`,
    description: '+30% бонус' 
  },
  { 
    stars: 50, 
    tokens: Math.floor(TOKENS_PER_STAR * 50 * 1.5), 
    label: `${Math.floor(TOKENS_PER_STAR * 50 * 1.5)} токенов`,
    description: '+50% бонус 🔥' 
  },
];

// ==================== КОМАНДЫ ====================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;

  try {
    // Создаем или получаем пользователя
    const user = userQueries.getOrCreateTelegramUser.get(
      chatId.toString(),
      username,
      FREE_TOKENS
    );

    const welcomeText = `
🍌 Добро пожаловать в Nano Banana!

Я помогу вам генерировать текст с помощью Google Gemini AI.

💎 Ваш баланс: ${user.tokens} токенов

📝 Просто отправьте мне любой текст, и я сгенерирую ответ!

Команды:
/balance - проверить баланс
/buy - купить токены
/history - история генераций
/help - помощь
    `;

    await bot.sendMessage(chatId, welcomeText);
  } catch (error) {
    console.error('Ошибка в /start:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при инициализации.');
  }
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    await bot.sendMessage(chatId, `💎 Ваш баланс: ${user.tokens} токенов`);
  } catch (error) {
    console.error('Ошибка в /balance:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении баланса.');
  }
});

bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const keyboard = {
      inline_keyboard: TOKEN_PACKAGES.map(pkg => [{
        text: `⭐ ${pkg.stars} Stars → ${pkg.tokens.toLocaleString('ru-RU')} ${pkg.description}`,
        callback_data: `buy_${pkg.stars}`
      }])
    };

    const priceInfo = `💰 *Магазин токенов*\n\n` +
      `💎 Ваш баланс: ${user.tokens.toLocaleString('ru-RU')} токенов\n\n` +
      `📊 Примерная стоимость операций:\n` +
      `• Текст (короткий): ~50-100 токенов\n` +
      `• Текст (длинный): ~200-500 токенов\n` +
      `• Генерация изображения: ~1000-3000 токенов\n` +
      `• Редактирование изображения: ~1500-4000 токенов\n\n` +
      `🎁 Больше покупаете = больше бонусов!`;

    await bot.sendMessage(
      chatId,
      priceInfo,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Ошибка в /buy:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при отображении пакетов.');
  }
});

bot.onText(/\/history/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const history = generationQueries.getHistory.all(user.id, 5);

    if (history.length === 0) {
      return await bot.sendMessage(chatId, '📝 История генераций пуста.');
    }

    let text = '📝 Последние генерации:\n\n';
    history.forEach((gen, idx) => {
      text += `${idx + 1}. "${gen.prompt.substring(0, 50)}..."\n`;
      text += `   Токенов: ${gen.tokens_used}\n`;
      text += `   Время: ${new Date(gen.created_at).toLocaleString('ru-RU')}\n\n`;
    });

    await bot.sendMessage(chatId, text);
  } catch (error) {
    console.error('Ошибка в /history:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении истории.');
  }
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;

  const helpText = `
🍌 Nano Banana - Помощь

📝 Как использовать:
1. Отправьте текст для генерации ответа
2. Напишите "нарисуй..." для генерации изображения
3. Отправьте фото + текст для редактирования изображения

💎 Токены:
- Новые пользователи получают ${FREE_TOKENS} токенов
- Покупайте токены через /buy
- 1 Star = ${TOKENS_PER_STAR.toLocaleString('ru-RU')} токенов

⭐ Команды:
/start - начать работу
/balance - проверить баланс
/buy - купить токены
/history - история генераций
/help - эта справка

🎨 Возможности:
• Генерация текста
• Создание изображений
• Редактирование изображений

❓ Вопросы? Напишите @your_support
  `;

  await bot.sendMessage(chatId, helpText);
});

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const adminId = process.env.ADMIN_TELEGRAM_ID;

  // Проверяем, является ли пользователь администратором
  if (adminId && chatId.toString() !== adminId) {
    return await bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде.');
  }

  try {
    const db = require('./database');
    
    // Общая статистика пользователей
    const totalUsers = db.db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    // Общая статистика транзакций
    const totalPurchases = db.db.prepare(`
      SELECT COUNT(*) as count, SUM(amount) as total_stars 
      FROM transactions WHERE type = 'purchase'
    `).get();
    
    // Общая статистика генераций
    const totalGenerations = db.db.prepare(`
      SELECT COUNT(*) as count, SUM(tokens_used) as total_tokens 
      FROM generations
    `).get();
    
    // Генерации за последние 24 часа
    const recentGens = db.db.prepare(`
      SELECT COUNT(*) as count 
      FROM generations 
      WHERE created_at > datetime('now', '-1 day')
    `).get();
    
    // Топ пользователей по покупкам
    const topBuyers = db.db.prepare(`
      SELECT u.username, SUM(t.amount) as total_spent
      FROM users u
      JOIN transactions t ON u.id = t.user_id
      WHERE t.type = 'purchase'
      GROUP BY u.id
      ORDER BY total_spent DESC
      LIMIT 5
    `).all();
    
    // Средний чек
    const avgPurchase = totalPurchases.total_stars && totalPurchases.count 
      ? (totalPurchases.total_stars / totalPurchases.count).toFixed(1)
      : 0;
    
    // Формируем отчет
    let statsText = `📊 *Статистика Nano Banana*\n\n`;
    
    statsText += `👥 *Пользователи:*\n`;
    statsText += `└ Всего: ${totalUsers.count}\n\n`;
    
    statsText += `💰 *Продажи:*\n`;
    statsText += `└ Всего покупок: ${totalPurchases.count || 0}\n`;
    statsText += `└ Заработано: ${totalPurchases.total_stars || 0} ⭐\n`;
    statsText += `└ Средний чек: ${avgPurchase} ⭐\n\n`;
    
    statsText += `🤖 *Генерации:*\n`;
    statsText += `└ Всего: ${totalGenerations.count || 0}\n`;
    statsText += `└ Использовано токенов: ${(totalGenerations.total_tokens || 0).toLocaleString('ru-RU')}\n`;
    statsText += `└ За 24 часа: ${recentGens.count || 0}\n\n`;
    
    if (topBuyers.length > 0) {
      statsText += `🏆 *Топ покупателей:*\n`;
      topBuyers.forEach((buyer, idx) => {
        statsText += `${idx + 1}. ${buyer.username}: ${buyer.total_spent} ⭐\n`;
      });
      statsText += `\n`;
    }
    
    // Расчет примерного дохода
    const estimatedRevenue = (totalPurchases.total_stars || 0) * 0.01; // $0.01 за Star
    const estimatedCost = ((totalGenerations.total_tokens || 0) / 1000000) * 0.15; // примерная стоимость API
    const estimatedProfit = estimatedRevenue - estimatedCost;
    
    statsText += `💵 *Финансы (приблизительно):*\n`;
    statsText += `└ Доход: $${estimatedRevenue.toFixed(2)}\n`;
    statsText += `└ Затраты API: $${estimatedCost.toFixed(2)}\n`;
    statsText += `└ Прибыль: $${estimatedProfit.toFixed(2)}\n\n`;
    
    statsText += `⚙️ *Настройки:*\n`;
    statsText += `└ Токенов за Star: ${TOKENS_PER_STAR}\n`;
    statsText += `└ Бесплатных токенов: ${FREE_TOKENS}\n`;
    
    await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Ошибка в /stats:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении статистики.');
  }
});

// ==================== ОБРАБОТКА ПЛАТЕЖЕЙ ====================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === 'check_balance') {
    // Обработка проверки баланса
    try {
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      if (!user) {
        return await bot.answerCallbackQuery(query.id, { 
          text: 'Используйте /start для начала работы.', 
          show_alert: true 
        });
      }

      await bot.answerCallbackQuery(query.id, { 
        text: `💎 Ваш баланс: ${user.tokens.toLocaleString('ru-RU')} токенов`, 
        show_alert: true 
      });
    } catch (error) {
      console.error('Ошибка проверки баланса:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data.startsWith('buy_')) {
    const stars = parseInt(data.split('_')[1]);
    const package_ = TOKEN_PACKAGES.find(p => p.stars === stars);

    if (!package_) {
      return await bot.answerCallbackQuery(query.id, { text: '❌ Пакет не найден' });
    }

    try {
      // Отправляем инвойс для оплаты Stars
      await bot.sendInvoice(
        chatId,
        `${package_.tokens.toLocaleString('ru-RU')} токенов для Nano Banana`,
        `Пакет: ${package_.label} | ${package_.description}`,
        `payload_${chatId}_${Date.now()}`,
        '', // provider_token пустой для Stars
        'XTR', // валюта Telegram Stars
        [{ label: package_.label, amount: stars }],
        {
          need_name: false,
          need_phone_number: false,
          need_email: false,
          need_shipping_address: false,
          is_flexible: false,
        }
      );

      await bot.answerCallbackQuery(query.id, { text: '💳 Инвойс отправлен!' });
    } catch (error) {
      console.error('Ошибка создания инвойса:', error);
      console.error('Детали ошибки:', error.response?.body || error.message);
      await bot.answerCallbackQuery(query.id, { 
        text: '❌ Ошибка создания платежа. Попробуйте позже.', 
        show_alert: true 
      });
    }
  }
});

// Обработка предпроверки платежа
bot.on('pre_checkout_query', async (query) => {
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
  } catch (error) {
    console.error('Ошибка pre_checkout:', error);
    await bot.answerPreCheckoutQuery(query.id, false, { error_message: 'Ошибка обработки платежа' });
  }
});

// Обработка успешного платежа
bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const stars = msg.successful_payment.total_amount;

  console.log(`💰 Успешный платеж: ${stars} Stars от пользователя ${chatId}`);

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      console.error(`❌ Пользователь ${chatId} не найден после успешной оплаты`);
      return await bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
    }

    const package_ = TOKEN_PACKAGES.find(p => p.stars === stars);
    
    if (!package_) {
      console.error(`❌ Пакет не найден для ${stars} Stars`);
      return await bot.sendMessage(chatId, '❌ Пакет не найден.');
    }

    // Начисляем токены
    userQueries.updateTokens.run(package_.tokens, user.id);

    // Записываем транзакцию
    transactionQueries.create.run(
      user.id,
      'purchase',
      package_.tokens,
      stars,
      `Покупка ${package_.label}`
    );

    const newBalance = user.tokens + package_.tokens;

    console.log(`✅ Токены начислены: ${package_.tokens} → баланс: ${newBalance}`);

    const successMessage = 
      `✅ *Платеж успешно обработан!*\n\n` +
      `💎 Начислено: ${package_.tokens.toLocaleString('ru-RU')} токенов\n` +
      `💎 Новый баланс: ${newBalance.toLocaleString('ru-RU')} токенов\n\n` +
      `🎉 Спасибо за покупку!\n` +
      `Теперь вы можете генерировать еще больше контента.`;

    await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    
    // Отправляем дополнительные кнопки быстрого доступа
    const quickActions = {
      inline_keyboard: [
        [{ text: '🤖 Создать текст', switch_inline_query_current_chat: '' }],
        [{ text: '🎨 Создать изображение', switch_inline_query_current_chat: 'нарисуй ' }],
        [{ text: '💎 Баланс', callback_data: 'check_balance' }]
      ]
    };
    
    await bot.sendMessage(
      chatId,
      '🚀 Что хотите создать?',
      { reply_markup: quickActions }
    );
    
  } catch (error) {
    console.error('Ошибка обработки платежа:', error);
    await bot.sendMessage(
      chatId, 
      '❌ Ошибка при начислении токенов. Пожалуйста, свяжитесь с поддержкой и сообщите код ошибки: PAY_ERR_' + Date.now()
    );
  }
});

// ==================== ГЕНЕРАЦИЯ ТЕКСТА ====================

bot.on('message', async (msg) => {
  // Игнорируем команды
  if (msg.text && msg.text.startsWith('/')) return;
  
  // Игнорируем системные сообщения
  if (msg.successful_payment) return;

  const chatId = msg.chat.id;
  const prompt = msg.text || msg.caption || '';

  // Проверяем есть ли фото в сообщении
  const hasPhoto = msg.photo && msg.photo.length > 0;
  
  // Если есть фото И текст (любой) - это запрос на редактирование
  if (hasPhoto && prompt && prompt.trim().length > 0) {
    // ==================== РЕДАКТИРОВАНИЕ ИЗОБРАЖЕНИЯ ====================
    try {
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      // Проверяем баланс
      if (user.tokens <= 0) {
        return await bot.sendMessage(
          chatId,
          '❌ У вас недостаточно токенов!\n\nИспользуйте /buy для покупки токенов.'
        );
      }

      await bot.sendChatAction(chatId, 'upload_photo');
      
      console.log(`✏️ Запрос на редактирование изображения: "${prompt}"`);
      await bot.sendMessage(chatId, '✏️ Редактирую изображение, подождите...');
      
      // Скачиваем фото (берём самое большое)
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      
      // Загружаем изображение
      const https = require('https');
      const imageBuffer = await new Promise((resolve, reject) => {
        https.get(fileLink, (response) => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      
      console.log(`📥 Изображение загружено (${imageBuffer.length} bytes)`);
      
      // Редактируем изображение
      const result = await imageService.editImage(imageBuffer, prompt);
      
      // Проверяем токены
      if (user.tokens < result.tokensUsed) {
        return await bot.sendMessage(
          chatId,
          `❌ Недостаточно токенов.\n\nТребуется: ${result.tokensUsed}\nДоступно: ${user.tokens}\n\nИспользуйте /buy`
        );
      }
      
      // Списываем токены
      userQueries.updateTokens.run(-result.tokensUsed, user.id);
      
      // Сохраняем
      generationQueries.create.run(user.id, `[Редактирование] ${prompt}`, '[Изображение]', result.tokensUsed);
      transactionQueries.create.run(user.id, 'generation', -result.tokensUsed, 0, 'Редактирование изображения');
      
      const newBalance = user.tokens - result.tokensUsed;
      
      // Отправляем отредактированное изображение
      try {
        await bot.sendPhoto(chatId, result.imageBuffer, {
          caption: `✏️ Изображение отредактировано!\n\n💎 Использовано токенов: ${result.tokensUsed}\n💎 Осталось: ${newBalance}`
        });
      } catch (photoError) {
        console.error('Ошибка отправки фото:', photoError);
        await bot.sendMessage(
          chatId,
          `✏️ Изображение отредактировано, но ошибка при отправке.\n\n💎 Использовано токенов: ${result.tokensUsed}\n💎 Осталось: ${newBalance}`
        );
      }
      
      return; // Выходим, обработка завершена
      
    } catch (error) {
      console.error('Ошибка редактирования изображения:', error);
      await bot.sendMessage(chatId, '❌ Произошла ошибка при редактировании изображения.');
      return;
    }
  }
  
  // Если просто фото без команды редактирования - игнорируем
  if (hasPhoto && !prompt) {
    return;
  }

  if (!prompt || prompt.trim().length === 0) {
    return;
  }

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    // Проверяем баланс
    if (user.tokens <= 0) {
      return await bot.sendMessage(
        chatId,
        '❌ У вас недостаточно токенов!\n\nИспользуйте /buy для покупки токенов.'
      );
    }

    // Проверяем, это запрос на генерацию изображения?
    const isImageRequest = ImageService.isImageRequest(prompt);
    
    if (isImageRequest) {
      // Генерация изображения
      await bot.sendChatAction(chatId, 'upload_photo');
      
      const imagePrompt = ImageService.extractImagePrompt(prompt);
      console.log(`🎨 Запрос на генерацию изображения: "${imagePrompt}"`);
      
      const result = await imageService.generateImage(imagePrompt);
      
      // Проверяем, хватит ли токенов
      if (user.tokens < result.tokensUsed) {
        return await bot.sendMessage(
          chatId,
          `❌ Недостаточно токенов.\n\nТребуется: ${result.tokensUsed}\nДоступно: ${user.tokens}\n\nИспользуйте /buy`
        );
      }
      
      // Списываем токены
      userQueries.updateTokens.run(-result.tokensUsed, user.id);
      
      // Сохраняем генерацию
      generationQueries.create.run(user.id, prompt, '[Изображение]', result.tokensUsed);
      
      // Сохраняем транзакцию
      transactionQueries.create.run(
        user.id,
        'generation',
        -result.tokensUsed,
        0,
        'Генерация изображения'
      );
      
      const newBalance = user.tokens - result.tokensUsed;
      
      // Отправляем изображение
      try {
        await bot.sendPhoto(chatId, result.imageBuffer, {
          caption: `🎨 Изображение сгенерировано!\n\n💎 Использовано токенов: ${result.tokensUsed}\n💎 Осталось: ${newBalance}`
        });
      } catch (photoError) {
        console.error('Ошибка отправки фото:', photoError);
        console.error('Детали:', photoError.stack);
        await bot.sendMessage(
          chatId,
          `🎨 Изображение сгенерировано, но произошла ошибка при отправке.\n\nОшибка: ${photoError.message}\n\n💎 Использовано токенов: ${result.tokensUsed}\n💎 Осталось: ${newBalance}`
        );
      }
      
    } else {
      // Обычная генерация текста
      await bot.sendChatAction(chatId, 'typing');
      
      const result = await gemini.generate(prompt);
      
      // Проверяем, хватит ли токенов
      if (user.tokens < result.tokensUsed) {
        return await bot.sendMessage(
          chatId,
          `❌ Недостаточно токенов для этого запроса.\n\nТребуется: ${result.tokensUsed}\nДоступно: ${user.tokens}\n\nИспользуйте /buy`
        );
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
      
      const newBalance = user.tokens - result.tokensUsed;
      
      // Отправляем ответ
      await bot.sendMessage(
        chatId,
        `${result.text}\n\n---\n💎 Использовано токенов: ${result.tokensUsed}\n💎 Осталось: ${newBalance}`
      );
    }

  } catch (error) {
    console.error('Ошибка генерации:', error);
    await bot.sendMessage(
      chatId,
      '❌ Произошла ошибка при генерации. Попробуйте позже.'
    );
  }
});

console.log('✅ Telegram бот инициализирован');

module.exports = bot;

