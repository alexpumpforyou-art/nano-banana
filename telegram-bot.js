const TelegramBot = require('node-telegram-bot-api');
const { userQueries, transactionQueries, generationQueries } = require('./database');
const GeminiService = require('./gemini-service');
const ImageService = require('./image-service');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const gemini = new GeminiService(process.env.GEMINI_API_KEY);
const imageService = new ImageService(process.env.GEMINI_API_KEY);

const FREE_TOKENS = parseInt(process.env.FREE_TOKENS) || 100;
const TOKENS_PER_STAR = parseInt(process.env.TOKENS_PER_STAR) || 1000;

// Пакеты токенов для покупки
const TOKEN_PACKAGES = [
  { stars: 1, tokens: 1000, label: '1000 токенов' },
  { stars: 5, tokens: 5500, label: '5500 токенов (+10% бонус)' },
  { stars: 10, tokens: 12000, label: '12000 токенов (+20% бонус)' },
  { stars: 25, tokens: 32500, label: '32500 токенов (+30% бонус)' },
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
        text: `⭐ ${pkg.stars} Stars = ${pkg.tokens} токенов`,
        callback_data: `buy_${pkg.stars}`
      }])
    };

    await bot.sendMessage(
      chatId,
      `💰 Выберите пакет токенов:\n\nТекущий баланс: ${user.tokens} токенов`,
      { reply_markup: keyboard }
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
1. Отправьте любой текст для генерации
2. Получите ответ от Gemini AI
3. Токены списываются автоматически

💎 Токены:
- Новые пользователи получают ${FREE_TOKENS} токенов
- Покупайте токены через /buy
- 1 Star ≈ ${TOKENS_PER_STAR} токенов

⭐ Команды:
/start - начать работу
/balance - проверить баланс
/buy - купить токены
/history - история генераций
/help - эта справка

❓ Вопросы? Напишите @your_support
  `;

  await bot.sendMessage(chatId, helpText);
});

// ==================== ОБРАБОТКА ПЛАТЕЖЕЙ ====================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('buy_')) {
    const stars = parseInt(data.split('_')[1]);
    const package_ = TOKEN_PACKAGES.find(p => p.stars === stars);

    if (!package_) {
      return await bot.answerCallbackQuery(query.id, { text: '❌ Пакет не найден' });
    }

    try {
      // Отправляем инвойс для оплаты Stars
      await bot.sendInvoice(
        chatId,
        `${package_.tokens} токенов для Nano Banana`,
        `Пакет: ${package_.label}`,
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

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('Ошибка создания инвойса:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка создания платежа' });
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

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
    }

    const package_ = TOKEN_PACKAGES.find(p => p.stars === stars);
    
    if (!package_) {
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

    await bot.sendMessage(
      chatId,
      `✅ Платеж успешен!\n\n💎 Начислено: ${package_.tokens} токенов\n💎 Новый баланс: ${newBalance} токенов`
    );
  } catch (error) {
    console.error('Ошибка обработки платежа:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при начислении токенов. Обратитесь в поддержку.');
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

