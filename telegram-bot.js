const TelegramBot = require('node-telegram-bot-api');
const { userQueries, transactionQueries, generationQueries, referralQueries, contentQueries, generateReferralCode } = require('./database-postgres');
const GeminiService = require('./gemini-service');
const YookassaService = require('./yookassa-service');
const ImageService = require('./image-service');
const sessionService = require('./session-service');
const { generationQueue } = require('./queue-service');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
      allowed_updates: [
        'message',
        'callback_query',
        'pre_checkout_query',
        'successful_payment'
      ]
    }
  }
});

// Принудительно удаляем вебхук перед стартом polling
const INSTANCE_ID = Math.floor(Math.random() * 10000);
bot.deleteWebHook().then(() => {
  console.log(`✅ Вебхук удален, используется polling. INSTANCE_ID: ${INSTANCE_ID}`);
  console.log('🚀 BOT VERSION: 1.2 (Debug Duplication)');
});
const gemini = new GeminiService(process.env.GEMINI_API_KEY);
const yookassa = new YookassaService(process.env.YOOKASSA_SHOP_ID, process.env.YOOKASSA_SECRET_KEY);
const imageService = new ImageService(process.env.GEMINI_API_KEY);

// Новая система кредитов (деноминация: 1 кредит = 1 текст, 2 кредита = 1 картинка)
const FREE_CREDITS = parseInt(process.env.FREE_CREDITS) || 5;
const CREDITS_PER_STAR = parseInt(process.env.CREDITS_PER_STAR) || 2; // 1 Star ~ 1.6 credits (based on 50 stars = 80 credits)
const REFERRAL_BONUS = parseInt(process.env.REFERRAL_BONUS) || 5; // бонус за реферала
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// Цены на операции (в кредитах)
const PRICES = {
  TEXT_SHORT: 1,      // текст
  TEXT_LONG: 1,       // длинный текст
  IMAGE_GEN: 2,       // генерация изображения
  IMAGE_EDIT: 2       // редактирование изображения
};

const YOOKASSA_PROVIDER_TOKEN = process.env.YOOKASSA_PROVIDER_TOKEN;

// Генерируем пакеты кредитов
const CREDIT_PACKAGES = [
  {
    stars: 50,
    price_rub: 50,
    credits: 10,
    label: `10 кредитов`,
    description: 'Пробный'
  },
  {
    stars: 250,
    price_rub: 250,
    credits: 60,
    label: `60 кредитов`,
    description: 'Базовый'
  },
  {
    stars: 500,
    price_rub: 500,
    credits: 140,
    label: `140 кредитов`,
    description: 'Популярный'
  },
  {
    stars: 1000,
    price_rub: 1000,
    credits: 350,
    label: `350 генераций`,
    description: 'Выгодный'
  },
  {
    stars: 5000,
    price_rub: 5000,
    credits: 4000,
    label: `4000 генераций`,
    description: 'Максимальный 🔥'
  }
];

// Для удаления старых сообщений
// Для удаления старых сообщений
// const userLastMessages = new Map(); // Moved to Redis
// const userStates = new Map(); // Moved to Redis

// Функция удаления старых сообщений
async function deleteOldMessages(chatId) {
  const messages = await sessionService.popLastMessages(chatId);
  for (const msgId of messages) {
    try {
      await bot.deleteMessage(chatId, msgId);
    } catch (e) {
      // Игнорируем ошибки удаления (сообщение уже удалено или слишком старое)
    }
  }
  await sessionService.clearState(chatId);
  // userLastMessages.delete(chatId); // Handled by popLastMessages
}

// Функция сохранения сообщения для удаления
async function rememberMessage(chatId, messageId) {
  await sessionService.addLastMessage(chatId, messageId);
}

// Функция отправки сообщения с запоминанием ID
async function sendAndRemember(chatId, text, options = {}) {
  const sentMsg = await bot.sendMessage(chatId, text, options);
  await rememberMessage(chatId, sentMsg.message_id);
  return sentMsg;
}

// Функция умной отправки сообщений (разбивает длинные тексты)
async function sendSmartMessage(chatId, text, options = {}) {
  const MAX_LENGTH = 4000; // Оставляем запас до 4096

  if (text.length <= MAX_LENGTH) {
    return await sendAndRemember(chatId, text, options);
  }

  // Разбиваем на части
  const parts = [];
  let currentPart = '';

  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentPart + line).length + 1 > MAX_LENGTH) {
      parts.push(currentPart);
      currentPart = line;
    } else {
      currentPart += (currentPart ? '\n' : '') + line;
    }
  }

  if (currentPart) {
    parts.push(currentPart);
  }

  // Если какая-то часть все равно слишком длинная (одна строка > 4000 символов)
  // Принудительно разбиваем её
  const finalParts = [];
  for (const part of parts) {
    if (part.length > MAX_LENGTH) {
      let remaining = part;
      while (remaining.length > 0) {
        finalParts.push(remaining.substring(0, MAX_LENGTH));
        remaining = remaining.substring(MAX_LENGTH);
      }
    } else {
      finalParts.push(part);
    }
  }

  // Отправляем части последовательно
  for (const part of finalParts) {
    await sendAndRemember(chatId, part, options);
  }
}

// Класс для анимированных статусных сообщений
class StatusMessage {
  constructor(bot, chatId) {
    this.bot = bot;
    this.chatId = chatId;
    this.messageId = null;
    this.intervalId = null;
    this.frames = ['.', '..', '...'];
    this.frameIndex = 0;
    this.baseText = '';
    this.isStopped = false;
  }

  async start(text) {
    this.baseText = text;
    this.isStopped = false;
    try {
      const msg = await this.bot.sendMessage(this.chatId, `${this.baseText} ${this.frames[0]}`);
      this.messageId = msg.message_id;

      // Отправляем action "печатает" или "загружает фото"
      this.bot.sendChatAction(this.chatId, 'typing').catch(() => { });

      this.intervalId = setInterval(async () => {
        if (this.isStopped) return;

        this.frameIndex = (this.frameIndex + 1) % this.frames.length;

        try {
          await this.bot.editMessageText(`${this.baseText} ${this.frames[this.frameIndex]}`, {
            chat_id: this.chatId,
            message_id: this.messageId
          });
        } catch (error) {
          // Если словили лимит (429), останавливаем анимацию, чтобы не спамить
          if (error.response && error.response.statusCode === 429) {
            console.warn(`⚠️ Rate limit hit in StatusMessage for chat ${this.chatId}. Stopping animation.`);
            this.stop();
          }
          // Игнорируем другие ошибки (например, сообщение не изменилось)
        }
      }, 3000); // Увеличили интервал до 3 секунд
    } catch (e) {
      console.error('Ошибка запуска статус-сообщения:', e);
    }
  }

  async stop() {
    this.isStopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.messageId) {
      try {
        await this.bot.deleteMessage(this.chatId, this.messageId);
      } catch (e) {
        // Игнорируем ошибки удаления
      }
      this.messageId = null;
    }
  }
}

// Обработка ошибок polling (важно для предотвращения падения бота)
bot.on('polling_error', (error) => {
  console.error('❌ POLLING ERROR:', error.code, error.message);
  if (error.code === 'ETELEGRAM' && error.message.includes('429')) {
    console.warn('⚠️ Telegram Rate Limit hit. Polling will retry automatically.');
  }
});

// ==================== КОМАНДЫ ====================

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const referralCode = match && match[1] ? match[1].trim() : null;

  try {
    await deleteOldMessages(chatId); // Удаляем старые сообщения

    let user = await userQueries.getByTelegramId(chatId.toString());
    let isNewUser = false;

    if (!user) {
      // Новый пользователь - создаем с реферальным кодом
      const newReferralCode = generateReferralCode();
      let referrerId = null;
      if (referralCode) {
        const referrer = await userQueries.getByReferralCode(referralCode);
        if (referrer && referrer.telegram_id !== chatId.toString()) {
          referrerId = referrer.id;
        }
      }

      const newUser = await userQueries.getOrCreateTelegramUser(
        chatId.toString(),
        username,
        FREE_CREDITS + (referrerId ? REFERRAL_BONUS : 0),
        newReferralCode
      );
      user = newUser; // Обновляем user для дальнейшего использования
      isNewUser = true;

      // Если пришел по реферальной ссылке
      if (referralCode) {
        const referrer = await userQueries.getByReferralCode(referralCode);
        if (referrer && referrer.telegram_id !== chatId.toString()) {
          // Устанавливаем реферера
          await userQueries.setReferrer(referrer.id, newUser.id);

          // Начисляем бонус рефереру
          await userQueries.addReferralBonus(REFERRAL_BONUS, REFERRAL_BONUS, referrer.id);

          // Записываем в таблицу рефералов
          await referralQueries.create(referrer.id, newUser.id, REFERRAL_BONUS);

          // Уведомляем реферера
          try {
            await bot.sendMessage(
              referrer.telegram_id,
              `🎉 По вашей ссылке зарегистрировался новый пользователь!\n\n💎 +${REFERRAL_BONUS} кредитов в подарок!`
            );
          } catch (e) { /* Игнорируем если не удалось отправить */ }

          console.log(`👥 Новый реферал: ${username} (реферер: ${referrer.username})`);
        }
      }
    }

    // Получаем динамический контент приветствия
    let welcomeContent = await contentQueries.getByType('welcome');
    let welcomeText = welcomeContent?.text ||
      `🍌 *Nano Banana AI*

👋 Привет! Я твой творческий помощник.

🎨 *Что я умею:*

✨ **Генерация изображений**
• "Нарисуй киберпанк город"
• "Создай логотип для кофейни"

✏️ **Редактирование фото**
• Отправь фото и напишите: "Добавь очки"
• "Сделай фон черно-белым"

💬 **Умный чат**
• Отвечаю на вопросы, пишу тексты, помогаю с идеями.

💎 Баланс: *{credits} кредитов*
📊 Генераций: {generations}

👇 *Меню:*`;

    // Заменяем переменные
    welcomeText = welcomeText
      .replace(/{credits}/g, user.credits)
      .replace(/{generations}/g, user.total_generations || 0)
      .replace(/{username}/g, username);

    // Добавляем реферальную ссылку если есть
    if (user.referral_code) {
      const botInfo = await bot.getMe();
      welcomeText += `\n\n🔗 Реферальная ссылка:\nt.me/${botInfo.username}?start=${user.referral_code}`;
    }

    // Конвертируем Markdown форматирование в HTML для безопасности
    welcomeText = welcomeText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*([^*]+)\*/g, '<b>$1</b>')
      .replace(/_([^_]+)_/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎨 Создать арт', callback_data: 'menu_image' },
          { text: '💎 Баланс', callback_data: 'menu_balance' }
        ],
        [
          { text: '💰 Пополнить', callback_data: 'menu_buy' },
          { text: '👥 Друзья', callback_data: 'menu_referral' }
        ],
        [
          { text: '📊 История', callback_data: 'menu_history' },
          { text: '❓ Помощь', callback_data: 'menu_help' }
        ]
      ]
    };

    if (ADMIN_TELEGRAM_ID && chatId.toString() === ADMIN_TELEGRAM_ID) {
      keyboard.inline_keyboard.push([
        { text: '👑 Админ-панель', callback_data: 'menu_admin' }
      ]);
    }

    // 1. Проверяем наличие локального GIF
    const fs = require('fs');
    const path = require('path');
    const gifPath = path.join(__dirname, 'public', 'welcome.gif');

    if (fs.existsSync(gifPath)) {
      try {
        await bot.sendAnimation(chatId, gifPath, {
          caption: welcomeText,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (gifError) {
        console.error('Ошибка отправки GIF:', gifError);
      }
    }

    // 2. Если GIF нет, проверяем изображение из БД (старая логика)
    if (welcomeContent?.image_data) {
      try {
        const imageBuffer = Buffer.from(welcomeContent.image_data, 'base64');
        await bot.sendPhoto(chatId, imageBuffer, {
          caption: welcomeText,
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
        return;
      } catch (photoError) {
        console.error('Ошибка отправки фото приветствия:', photoError);
      }
    }

    // 3. Если ничего нет, отправляем просто текст
    await sendAndRemember(chatId, welcomeText, { reply_markup: keyboard, parse_mode: 'HTML' });
  } catch (error) {
    console.error('Ошибка в /start:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при инициализации.');
  }
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(chatId.toString());

    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const refCount = await userQueries.countReferrals(user.id);

    const balanceText = `
💎 *Ваша статистика*

💰 Баланс: *${user.credits} кредитов*
📊 Всего генераций: ${user.total_generations || 0}
📉 Потрачено: ${user.total_spent_credits || 0} кредитов

👥 Рефералы: ${refCount.count || 0}
🎁 Бонусов заработано: ${user.referral_bonus_earned || 0} кредитов

📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}
    `;

    await sendAndRemember(chatId, balanceText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Ошибка в /balance:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении баланса.');
  }
});

bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(chatId.toString());

    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    // Предлагаем выбор валюты
    const keyboard = {
      inline_keyboard: [
        [
          { text: '⭐ Telegram Stars', callback_data: 'buy_method_stars' },
          { text: '₽ Рубли (ЮKassa)', callback_data: 'buy_method_rub' }
        ]
      ]
    };

    const priceInfo = `💰 *Магазин кредитов*\n\n` +
      `💎 Ваш баланс: ${user.credits} кредитов\n\n` +
      `Выберите способ оплаты:`;

    const sentMsg = await bot.sendMessage(
      chatId,
      priceInfo,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );

    await rememberMessage(chatId, sentMsg.message_id);
  } catch (error) {
    console.error('Ошибка в /buy:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при отображении пакетов.');
  }
});

bot.onText(/\/history/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const user = await userQueries.getByTelegramId(chatId.toString());

    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const history = await generationQueries.getHistory(user.id, 5);

    if (history.length === 0) {
      return await bot.sendMessage(chatId, '📝 История генераций пуста.');
    }

    let text = '📝 Последние генерации:\n\n';
    history.forEach((gen, idx) => {
      text += `${idx + 1}. "${gen.prompt.substring(0, 50)}..."\n`;
      text += `   Кредитов: ${gen.credits_used}\n`;
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
🍌 *Nano Banana - Инструкция*

🤖 *Как общаться:*
Просто пишите как человеку. Я понимаю контекст.
• _"Расскажи сказку про репку"_
• _"Переведи на английский: Привет мир"_
• _"Составь план тренировок"_

🎨 *Как рисовать:*
Используйте ключевые слова: "нарисуй", "создай", "сгенерируй".
• _"Нарисуй кота в космосе"_
• _"Создай логотип для кофейни"_

✏️ *Как редактировать:*
1. Нажмите на скрепку 📎 и отправьте фото.
2. В подписи к фото напишите, что сделать.
• _"Сделай фон черно-белым"_
• _"Добавь шляпу"_

💎 *Кредиты:*
• Текст: 1 кредит
• Картинка: 2 кредита
• Редактирование: 2 кредита

💰 Пополнить баланс: /buy
❓ Поддержка: /support
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
    const db = require('./database-postgres');

    // Общая статистика пользователей
    const totalUsers = await db.knex('users').count('* as count').first();

    // Общая статистика транзакций
    const totalPurchases = await db.knex('transactions')
      .select(
        db.knex.raw('COUNT(*) as count'),
        db.knex.raw("SUM(CASE WHEN type = 'payment' THEN price ELSE 0 END) as total_stars"),
        db.knex.raw("SUM(CASE WHEN type = 'purchase_yookassa' THEN price ELSE 0 END) as total_rub_received")
      )
      .whereIn('type', ['payment', 'purchase_yookassa'])
      .first();

    // Общая статистика генераций
    const totalGenerations = await db.knex('generations')
      .select(db.knex.raw('COUNT(*) as count'), db.knex.raw("SUM(cost) as total_credits"))
      .first();

    // Генерации за последние 24 часа
    const recentGens = await db.knex('generations')
      .count('* as count')
      .where('created_at', '>', db.knex.raw("NOW() - INTERVAL '1 DAY'"))
      .first();

    // Топ пользователей по покупкам
    const topBuyers = await db.knex('users as u')
      .join('transactions as t', 'u.id', 't.user_id')
      .select('u.username')
      .sum('t.amount as total_spent')
      .groupBy('u.username')
      .orderBy('total_spent', 'desc')
      .limit(5);

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
    statsText += `└ Заработано Stars: ${totalPurchases.total_stars || 0} ⭐\n`;
    statsText += `└ Заработано RUB: ${(totalPurchases.total_rub_received || 0).toLocaleString('ru-RU')} ₽\n`;
    statsText += `└ Средний чек: ${avgPurchase} ⭐\n\n`;

    statsText += `🤖 *Генерации:*\n`;
    statsText += `└ Всего: ${totalGenerations.count || 0}\n`;
    statsText += `└ Использовано кредитов: ${(totalGenerations.total_credits || 0).toLocaleString('ru-RU')}\n`;
    statsText += `└ За 24 часа: ${recentGens.count || 0}\n\n`;

    if (topBuyers.length > 0) {
      statsText += `🏆 *Топ покупателей:*\n`;
      topBuyers.forEach((buyer, idx) => {
        statsText += `${idx + 1}. ${buyer.username}: ${buyer.total_spent} ⭐\n`;
      });
      statsText += `\n`;
    }

    // Расчет примерного дохода
    const starsRevenue = (totalPurchases.total_stars || 0) * 0.01; // $0.01 за Star
    const rubRevenue = (totalPurchases.total_rub_received || 0) / 100; // Примерно 100 RUB = $1 (грубо)
    const estimatedRevenue = starsRevenue + rubRevenue;
    const estimatedCost = ((totalGenerations.total_credits || 0) * 50 / 1000000) * 0.15; // кредиты * 50 = токены, примерная стоимость API
    const estimatedProfit = estimatedRevenue - estimatedCost;

    statsText += `💵 *Финансы (приблизительно):*\n`;
    statsText += `└ Доход: $${estimatedRevenue.toFixed(2)}\n`;
    statsText += `└ Затраты API: $${estimatedCost.toFixed(2)}\n`;
    statsText += `└ Прибыль: $${estimatedProfit.toFixed(2)}\n\n`;

    statsText += `⚙️ *Настройки:*\n`;
    statsText += `└ Кредитов за Star: ${CREDITS_PER_STAR}\n`;
    statsText += `└ Бесплатных кредитов: ${FREE_CREDITS}\n`;

    await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Ошибка в /stats:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении статистики.');
  }
});

bot.onText(/\/referral/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(chatId.toString());

    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const referrals = await userQueries.getReferrals(user.id);
    const refCount = referrals.length;

    // Получаем имя бота для ссылки
    const botInfo = await bot.getMe();

    let referralText = `
👥 *Реферальная программа*

🔗 Ваша реферальная ссылка:
\`t.me/${botInfo.username}?start=${user.referral_code}\`

💰 Вы получаете: *${REFERRAL_BONUS} кредитов* за каждого друга
🎁 Ваш друг получает: *${FREE_CREDITS} кредитов* при регистрации

📊 *Ваша статистика:*
👥 Приглашено друзей: ${refCount}
💎 Заработано кредитов: ${user.referral_bonus_earned || 0}
    `;

    if (referrals.length > 0) {
      referralText += `\n\n🏆 *Ваши рефералы:*\n`;
      referrals.slice(0, 10).forEach((ref, idx) => {
        referralText += `${idx + 1}. @${ref.username || 'пользователь'} (${ref.total_generations || 0} генераций)\n`;
      });
      if (referrals.length > 10) {
        referralText += `\n_...и еще ${referrals.length - 10}_`;
      }
    }

    await sendAndRemember(chatId, referralText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Ошибка в /referral:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении реферальной информации.');
  }
});

// ==================== ОБЯЗАТЕЛЬНЫЕ КОМАНДЫ ДЛЯ TELEGRAM STARS ====================

bot.onText(/\/paysupport/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);

    const supportText = `
💳 *Поддержка по оплате*

📞 *Есть вопросы по платежам?*

🔹 *Часто задаваемые вопросы:*

**1. Как купить кредиты?**
Нажмите /buy и выберите пакет. Оплата через Telegram Stars.

**2. Что такое Telegram Stars (⭐)?**
Это внутренняя валюта Telegram для оплаты цифровых товаров.

**3. Как получить Stars?**
• App Store / Google Play (в приложении Telegram)
• Бот @PremiumBot
• Платформа Fragment (Toncoin)

**4. Не прошла оплата**
Проверьте:
• Достаточно ли Stars на балансе
• Попробуйте перезапустить бота (/start)
• Подождите 1-2 минуты и попробуйте снова

**5. Возврат средств**
Возврат возможен в течение 3 лет. Свяжитесь с поддержкой: /support

**6. Проблемы с платежом**
Если платеж висит или не проходит:
1. Закройте форму оплаты
2. Перезапустите бота /start
3. Попробуйте снова

💬 *Не нашли ответ?*
Свяжитесь с нами: /support
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '💰 Купить кредиты', callback_data: 'menu_buy' },
          { text: '💎 Мой баланс', callback_data: 'menu_balance' }
        ],
        [
          { text: '📞 Общая поддержка', callback_data: 'contact_support' },
          { text: '📋 Условия', callback_data: 'show_terms' }
        ],
        [{ text: '◀️ Главное меню', callback_data: 'menu_back' }]
      ]
    };

    await sendAndRemember(chatId, supportText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch (error) {
    console.error('Ошибка в /paysupport:', error);
    await bot.sendMessage(chatId, '❌ Ошибка. Попробуйте /start');
  }
});

bot.onText(/\/support/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);

    const supportText = `
📞 *Поддержка Nano Banana*

👋 Здравствуйте! Мы готовы помочь.

**Выберите тему вопроса:**

💳 *Оплата и платежи*
Вопросы по покупке кредитов, Stars, возврату средств
→ /paysupport

🎨 *Генерация изображений*
Не работает генерация, ошибки, качество изображений
→ /help (раздел "Генерация")

💎 *Кредиты и баланс*
Вопросы о начислении, бонусах, реферальной программе
→ /balance

🐛 *Технические проблемы*
Бот не отвечает, ошибки, глюки
→ Опишите проблему ниже

📝 *Общие вопросы*
Как пользоваться, возможности бота
→ /help

📧 *Прямой контакт:*
Для срочных вопросов напишите администратору${ADMIN_TELEGRAM_ID ? `\nTelegram ID: \`${ADMIN_TELEGRAM_ID}\`` : ''}

⏰ *Время ответа:* Обычно в течение 24 часов

💡 *Совет:* Опишите проблему максимально подробно - это ускорит решение!
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '💳 Оплата', callback_data: 'support_payment' },
          { text: '🎨 Генерация', callback_data: 'support_generation' }
        ],
        [
          { text: '💎 Баланс', callback_data: 'menu_balance' },
          { text: '❓ Помощь', callback_data: 'menu_help' }
        ],
        [{ text: '◀️ Главное меню', callback_data: 'menu_back' }]
      ]
    };

    await sendAndRemember(chatId, supportText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch (error) {
    console.error('Ошибка в /support:', error);
    await bot.sendMessage(chatId, '❌ Ошибка. Попробуйте /start');
  }
});

bot.onText(/\/terms/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);

    const termsText = `
📋 *Условия использования Nano Banana*

**Последнее обновление:** ${new Date().toLocaleDateString('ru-RU')}

**1. Общие положения**

1.1. Nano Banana ("Бот") предоставляет услуги генерации изображений и текста с помощью искусственного интеллекта Google Gemini.

1.2. Используя Бота, вы соглашаетесь с настоящими Условиями.

**2. Кредиты и оплата**

2.1. Услуги оплачиваются кредитами. Новые пользователи получают ${FREE_CREDITS} бесплатных кредитов.

2.2. Покупка кредитов осуществляется через Telegram Stars (⭐).

2.3. Цены:
• Текст: 1 кредит
• Изображение: 2 кредита
• Редактирование: 2 кредита

2.4. После покупки возврат невозможен, кроме случаев технической ошибки.

**3. Использование сервиса**

3.1. Запрещено:
• Генерировать запрещенный контент
• Использовать для спама или мошенничества
• Нарушать авторские права
• Генерировать изображения реальных людей без их согласия

3.2. Бот имеет право заблокировать аккаунт при нарушении правил.

**4. Интеллектуальная собственность**

4.1. Сгенерированный контент принадлежит пользователю.

4.2. Бот оставляет за собой право использовать статистику для улучшения сервиса.

**5. Ограничение ответственности**

5.1. Бот не несет ответственности за содержание сгенерированного контента.

5.2. Сервис предоставляется "как есть" без гарантий.

5.3. Возможны технические сбои и перерывы в работе.

**6. Конфиденциальность**

6.1. Мы собираем минимальные данные: Telegram ID, история генераций.

6.2. Данные не передаются третьим лицам.

6.3. История генераций хранится для статистики.

**7. Реферальная программа**

7.1. За приглашенного друга вы получаете ${REFERRAL_BONUS} кредитов.

7.2. Новый пользователь получает ${FREE_CREDITS} кредитов.

7.3. Бонусы начисляются автоматически.

**8. Изменения условий**

8.1. Условия могут быть изменены в любое время.

8.2. Продолжение использования означает согласие с новыми условиями.

**9. Поддержка**

📞 Вопросы по оплате: /paysupport
📞 Общая поддержка: /support

**10. Контакты**

Поддержка: /support
${ADMIN_TELEGRAM_ID ? `Администратор: \`${ADMIN_TELEGRAM_ID}\`` : ''}

---

✅ Используя бота, вы соглашаетесь с этими условиями.
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Принимаю условия', callback_data: 'accept_terms' },
          { text: '📞 Поддержка', callback_data: 'contact_support' }
        ],
        [{ text: '◀️ Главное меню', callback_data: 'menu_back' }]
      ]
    };

    await sendAndRemember(chatId, termsText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch (error) {
    console.error('Ошибка в /terms:', error);
    await bot.sendMessage(chatId, '❌ Ошибка. Попробуйте /start');
  }
});

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;

  // Проверка прав админа
  if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
    return await bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде.');
  }

  try {
    await deleteOldMessages(chatId);

    const adminText = `
👑 *Панель администратора*

Доступные команды:

/adminstats - полная статистика
/adminuser <telegram_id> - информация о пользователе
/adminadd <telegram_id> <credits> - начислить кредиты
/adminblock <telegram_id> - заблокировать пользователя
/adminunblock <telegram_id> - разблокировать
/adminbroadcast - рассылка (в разработке)

📊 Быстрая статистика:
Используйте /stats для просмотра общей статистики.
    `;

    await sendAndRemember(chatId, adminText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Ошибка в /admin:', error);
    await bot.sendMessage(chatId, '❌ Ошибка.');
  }
});

bot.onText(/\/adminuser\s+(\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const targetTelegramId = match[1];

  if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(targetTelegramId);

    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    const refCount = await userQueries.countReferrals(user.id);

    const userInfo = `
👤 *Информация о пользователе*

📝 Username: @${user.username || 'нет'}
🆔 Telegram ID: \`${user.telegram_id}\`
💎 Кредиты: ${user.credits}
📊 Генераций: ${user.total_generations || 0}
📉 Потрачено: ${user.total_spent_credits || 0}
👥 Рефералов: ${refCount.count || 0}
🎁 Бонусов: ${user.referral_bonus_earned || 0}
🔒 Заблокирован: ${user.is_blocked ? 'Да' : 'Нет'}
📅 Регистрация: ${new Date(user.created_at).toLocaleString('ru-RU')}
    `;

    await sendAndRemember(chatId, userInfo, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Ошибка в /adminuser:', error);
    await bot.sendMessage(chatId, '❌ Ошибка.');
  }
});

bot.onText(/\/adminadd\s+(\S+)\s+(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const targetTelegramId = match[1];
  const creditsToAdd = parseInt(match[2]);

  if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(targetTelegramId);

    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    await userQueries.updateCredits(creditsToAdd, user.id);
    await transactionQueries.create(user.id, 'admin_bonus', creditsToAdd, 0, 'Начислено администратором');

    await bot.sendMessage(targetTelegramId, `🎁 Вам начислено ${creditsToAdd} кредитов от администратора!`);
    await sendAndRemember(chatId, `✅ Пользователю @${user.username} начислено ${creditsToAdd} кредитов`);
  } catch (error) {
    console.error('Ошибка в /adminadd:', error);
    await bot.sendMessage(chatId, '❌ Ошибка.');
  }
});

bot.onText(/\/adminblock\s+(\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const targetTelegramId = match[1];

  if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(targetTelegramId);

    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    await userQueries.setBlocked(1, user.id);
    await sendAndRemember(chatId, `✅ Пользователь @${user.username} заблокирован`);
  } catch (error) {
    console.error('Ошибка в /adminblock:', error);
    await bot.sendMessage(chatId, '❌ Ошибка.');
  }
});

bot.onText(/\/adminunblock\s+(\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const targetTelegramId = match[1];

  if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
    return;
  }

  try {
    await deleteOldMessages(chatId);

    const user = await userQueries.getByTelegramId(targetTelegramId);

    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    await userQueries.setBlocked(0, user.id);
    await sendAndRemember(chatId, `✅ Пользователь @${user.username} разблокирован`);
  } catch (error) {
    console.error('Ошибка в /adminunblock:', error);
    await bot.sendMessage(chatId, '❌ Ошибка.');
  }
});

// ==================== ОБРАБОТКА ПЛАТЕЖЕЙ ====================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  console.log(`🔔 Callback received: ${data} from ${chatId}`);

  // Удаляем старое сообщение для всех кнопок меню
  if (data.startsWith('menu_')) {
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch (e) {
      // Игнорируем ошибки удаления
    }
  }

  // Обработка кнопок главного меню
  if (data === 'menu_balance') {
    console.log(`[${INSTANCE_ID}] Processing menu_balance for ${chatId}`);
    try {
      const user = await userQueries.getByTelegramId(chatId.toString());

      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const refCount = await userQueries.countReferrals(user.id);

      const balanceText = `
💎 *Ваша статистика*

💰 Баланс: *${user.credits} кредитов*
📊 Всего генераций: ${user.total_generations || 0}
📉 Потрачено: ${user.total_spent_credits || 0} кредитов

👥 Рефералы: ${refCount.count || 0}
🎁 Бонусов заработано: ${user.referral_bonus_earned || 0} кредитов

📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}
      `;

      const backButton = {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
      };

      await bot.answerCallbackQuery(query.id);
      await sendAndRemember(chatId, balanceText, { parse_mode: 'Markdown', reply_markup: backButton });
    } catch (error) {
      console.error('Ошибка menu_balance:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'menu_buy') {
    try {
      const user = await userQueries.getByTelegramId(chatId.toString());

      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⭐ Telegram Stars', callback_data: 'buy_method_stars' },
            { text: '💳 Рубли (ЮKassa)', callback_data: 'buy_method_rub' }
          ],
          [{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]
        ]
      };

      const priceInfo = `💰 *Магазин кредитов*\n\n` +
        `💎 Ваш баланс: ${user.credits} кредитов\n\n` +
        `📊 Стоимость операций:\n` +
        `• Текст: 1 кредит\n` +
        `• Генерация изображения: 2 кредита\n` +
        `• Редактирование изображения: 2 кредита\n\n` +
        `🎁 Больше покупаете = дешевле генерация!`;

      await bot.answerCallbackQuery(query.id);
      const sentMsg = await bot.sendMessage(chatId, priceInfo, { reply_markup: keyboard, parse_mode: 'Markdown' });

      await rememberMessage(chatId, sentMsg.message_id);
    } catch (error) {
      console.error('Ошибка menu_buy:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'menu_referral') {
    try {
      const user = await userQueries.getByTelegramId(chatId.toString());

      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const referrals = await userQueries.getReferrals(user.id);
      const refCount = referrals.length;

      // Получаем имя бота для ссылки
      const botInfo = await bot.getMe();

      let referralText = `
👥 *Реферальная программа*

🔗 Ваша реферальная ссылка:
\`t.me/${botInfo.username}?start=${user.referral_code}\`

💰 Вы получаете: *${REFERRAL_BONUS} кредитов* за каждого друга
🎁 Ваш друг получает: *${FREE_CREDITS} кредитов* при регистрации

📊 *Ваша статистика:*
👥 Приглашено друзей: ${refCount}
💎 Заработано кредитов: ${user.referral_bonus_earned || 0}
      `;

      if (referrals.length > 0) {
        referralText += `\n\n🏆 *Ваши рефералы:*\n`;
        referrals.slice(0, 10).forEach((ref, idx) => {
          referralText += `${idx + 1}. @${ref.username || 'пользователь'} (${ref.total_generations || 0} генераций)\n`;
        });
        if (referrals.length > 10) {
          referralText += `\n_...и еще ${referrals.length - 10}_`;
        }
      }

      const backButton = {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
      };

      await bot.answerCallbackQuery(query.id);
      await sendAndRemember(chatId, referralText, { parse_mode: 'Markdown', reply_markup: backButton });
    } catch (error) {
      console.error('Ошибка menu_referral:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'menu_history') {
    try {
      const user = await userQueries.getByTelegramId(chatId.toString());

      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const history = await generationQueries.getHistory(user.id, 5);

      if (history.length === 0) {
        const backButton = {
          inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
        };
        await bot.answerCallbackQuery(query.id);
        return await sendAndRemember(chatId, '📝 История генераций пуста.', { reply_markup: backButton });
      }

      let text = '📝 *Последние генерации:*\n\n';
      history.forEach((gen, idx) => {
        text += `${idx + 1}. "${gen.prompt.substring(0, 50)}..."\n`;
        text += `   💎 ${gen.credits_used} кредитов | ${new Date(gen.created_at).toLocaleString('ru-RU')}\n\n`;
      });

      const backButton = {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
      };

      await bot.answerCallbackQuery(query.id);
      await sendAndRemember(chatId, text, { parse_mode: 'Markdown', reply_markup: backButton });
    } catch (error) {
      console.error('Ошибка menu_history:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'menu_help') {
    const helpText = `
🍌 *Nano Banana - Помощь*

🤖 *Текст:* Просто пишите вопрос.
_Пример: "Как приготовить пасту?"_

🎨 *Картинки:* Начните с "Нарисуй".
_Пример: "Нарисуй синего дракона"_

✏️ *Редактирование:* Отправьте фото + описание.
_Пример: "Убеди фон"_

💎 *Баланс:*
• 1 картинка = 2 кредита
• Новичкам: ${FREE_CREDITS} кредитов бесплатно!

💰 Купить кредиты: кнопка "💰 Купить кредиты"
    `;

    const backButton = {
      inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
    };

    await bot.answerCallbackQuery(query.id);
    await sendAndRemember(chatId, helpText, { parse_mode: 'Markdown', reply_markup: backButton });
  } else if (data === 'menu_image') {
    const imageText = `
🎨 *Генерация изображений*

✅ *Как генерировать:*
Напишите: "нарисуй пингвина на льдине"
Или: "создай картинку с котом в космосе"

✅ *Как редактировать:*
1. Отправьте фото боту
2. Добавьте описание: "добавь шляпу" или "сделай фон синим"
3. Получите отредактированное изображение!

💎 *Цены:*
• Генерация: ${PRICES.IMAGE_GEN} кредитов
• Редактирование: ${PRICES.IMAGE_EDIT} кредитов

🔥 Попробуйте прямо сейчас!
    `;

    const backButton = {
      inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
    };

    await bot.answerCallbackQuery(query.id);
    await sendAndRemember(chatId, imageText, { parse_mode: 'Markdown', reply_markup: backButton });
  } else if (data === 'menu_admin') {
    if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
      return await bot.answerCallbackQuery(query.id, { text: '❌ Нет доступа', show_alert: true });
    }

    const adminText = `
👑 *Панель администратора*

Команды:
/adminuser <id> - инфо о пользователе
/adminadd <id> <credits> - начислить
/adminblock <id> - заблокировать
/adminunblock <id> - разблокировать

Или нажмите на кнопку для статистики:
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
        [{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]
      ]
    };

    await bot.answerCallbackQuery(query.id);
    await sendAndRemember(chatId, adminText, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else if (data === 'admin_stats') {
    if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
      return await bot.answerCallbackQuery(query.id, { text: '❌ Нет доступа', show_alert: true });
    }

    try {
      await bot.answerCallbackQuery(query.id);

      const db = require('./database-postgres');

      const totalUsers = await db.knex('users').count('* as count').first();
      const totalPurchases = await db.knex('transactions')
        .select(
          db.knex.raw('COUNT(*) as count'),
          db.knex.raw("SUM(CASE WHEN type = 'payment' THEN price ELSE 0 END) as total_stars"),
          db.knex.raw("SUM(CASE WHEN type = 'purchase_yookassa' THEN price ELSE 0 END) as total_rub_received")
        )
        .whereIn('type', ['payment', 'purchase_yookassa'])
        .first();
      const totalGenerations = await db.knex('generations')
        .select(db.knex.raw('COUNT(*) as count'), db.knex.raw("SUM(cost) as total_credits"))
        .first();
      const recentGens = await db.knex('generations')
        .count('* as count')
        .where('created_at', '>', db.knex.raw("NOW() - INTERVAL '1 DAY'"))
        .first();

      const avgPurchase = totalPurchases.total_stars && totalPurchases.count ? (totalPurchases.total_stars / totalPurchases.count).toFixed(1) : 0;

      const starsRevenue = (totalPurchases.total_stars || 0) * 0.01;
      const rubRevenue = (totalPurchases.total_rub_received || 0) / 100;
      const estimatedRevenue = starsRevenue + rubRevenue;

      const estimatedCost = ((totalGenerations.total_credits || 0) * 50 / 1000000) * 0.15;
      const estimatedProfit = estimatedRevenue - estimatedCost;

      let statsText = `📊 *Статистика Nano Banana*\n\n`;
      statsText += `👥 Пользователей: ${totalUsers.count}\n\n`;
      statsText += `💰 *Продажи:*\n`;
      statsText += `└ Покупок: ${totalPurchases.count || 0}\n`;
      statsText += `└ Заработано Stars: ${totalPurchases.total_stars || 0} ⭐\n`;
      statsText += `└ Заработано RUB: ${(totalPurchases.total_rub_received || 0).toLocaleString('ru-RU')} ₽\n`;
      statsText += `└ Средний чек: ${avgPurchase} ⭐\n\n`;
      statsText += `🤖 *Генерации:*\n`;
      statsText += `└ Всего: ${totalGenerations.count || 0}\n`;
      statsText += `└ Использовано: ${(totalGenerations.total_credits || 0).toLocaleString('ru-RU')} кредитов\n`;
      statsText += `└ За 24 часа: ${recentGens.count || 0}\n\n`;
      statsText += `💵 *Финансы:*\n`;
      statsText += `└ Доход: $${estimatedRevenue.toFixed(2)}\n`;
      statsText += `└ Затраты: $${estimatedCost.toFixed(2)}\n`;
      statsText += `└ Прибыль: $${estimatedProfit.toFixed(2)}`;

      const backButton = {
        inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_admin' }]]
      };

      await sendAndRemember(chatId, statsText, { parse_mode: 'Markdown', reply_markup: backButton });
    } catch (error) {
      console.error('Ошибка admin_stats:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'menu_back') {
    // Возвращаемся в главное меню
    try {
      await bot.answerCallbackQuery(query.id);

      const user = await userQueries.getByTelegramId(chatId.toString());

      // Используем динамический контент приветствия
      const welcomeContent = await contentQueries.getByType('welcome');
      let welcomeText = welcomeContent?.text ||
        `🍌 *Главное меню*

1️⃣ **Чат** — просто пишите текст
2️⃣ **Рисование** — пишите "Нарисуй..."
3️⃣ **Редактирование** — отправьте фото

💎 Баланс: *{credits} кредитов*
👇 Выберите раздел:`;

      // Заменяем переменные
      welcomeText = welcomeText
        .replace(/{credits}/g, user.credits)
        .replace(/{generations}/g, user.total_generations || 0)
        .replace(/{username}/g, user.username || 'пользователь');

      // Конвертируем Markdown в HTML для безопасности
      welcomeText = welcomeText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*([^*]+)\*/g, '<b>$1</b>')
        .replace(/_([^_]+)_/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🎨 Генерация изображений', callback_data: 'menu_image' },
            { text: '💎 Баланс', callback_data: 'menu_balance' }
          ],
          [
            { text: '💰 Купить кредиты', callback_data: 'menu_buy' },
            { text: '👥 Рефералы', callback_data: 'menu_referral' }
          ],
          [
            { text: '📊 История', callback_data: 'menu_history' },
            { text: '❓ Помощь', callback_data: 'menu_help' }
          ]
        ]
      };

      if (ADMIN_TELEGRAM_ID && chatId.toString() === ADMIN_TELEGRAM_ID) {
        keyboard.inline_keyboard.push([
          { text: '👑 Админ-панель', callback_data: 'menu_admin' }
        ]);
      }

      await sendAndRemember(chatId, welcomeText, { reply_markup: keyboard, parse_mode: 'HTML' });
    } catch (error) {
      console.error('Ошибка menu_back:', error);
    }
  } else if (data === 'check_balance') {
    // Обработка проверки баланса
    try {
      const user = await userQueries.getByTelegramId(chatId.toString());

      if (!user) {
        return await bot.answerCallbackQuery(query.id, {
          text: 'Используйте /start для начала работы.',
          show_alert: true
        });
      }

      await bot.answerCallbackQuery(query.id, {
        text: `💎 Ваш баланс: ${user.credits} кредитов`,
        show_alert: true
      });
    } catch (error) {
      console.error('Ошибка проверки баланса:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'buy_method_rub') {
    // Предлагаем пакеты в рублях
    // 1 Star = 2000 токенов (примерно 2 кредита, если 1 кредит = 1000 токенов? Нет, надо проверить логику)
    // В PAYMENTS_SETUP.md: 1 Star = 2000 токенов.
    // В коде: CREDITS_PER_STAR = 2. Значит 1 кредит = 1000 токенов.
    // Курс Stars к рублю примерно 1 Star ~ 2 RUB (очень грубо, зависит от платформы).
    // Сделаем пакеты:
    // 100 RUB -> 200 кредитов
    // 300 RUB -> 700 кредитов (+бонус)
    // 500 RUB -> 1200 кредитов (+бонус)

    const keyboard = {
      inline_keyboard: [
        [{ text: '💎 10 кредитов - 50₽ (10₽/фото)', callback_data: 'buy_rub_50' }],
        [{ text: '💎 60 кредитов - 250₽ (8.3₽/фото)', callback_data: 'buy_rub_250' }],
        [{ text: '💎 140 кредитов - 500₽ (7.1₽/фото)', callback_data: 'buy_rub_500' }],
        [{ text: '💎 350 кредитов - 1000₽ (5.7₽/фото)', callback_data: 'buy_rub_1000' }],
        [{ text: '💎 4000 кредитов - 5000₽ (🔥 2.5₽/фото)', callback_data: 'buy_rub_5000' }],
        [{ text: '◀️ Назад', callback_data: 'menu_buy' }]
      ]
    };

    await bot.editMessageText('🇷🇺 *Оплата картой РФ (ЮKassa)*\n\nВыберите пакет кредитов:', {
      chat_id: chatId,
      message_id: query.message.message_id,

      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    return;
  } else if (data.startsWith('buy_rub_')) {
    const amount = parseInt(data.split('_')[2]);
    let credits = 0;

    // Определяем количество кредитов
    switch (amount) {
      case 50: credits = 10; break;
      case 250: credits = 60; break;
      case 500: credits = 140; break;
      case 1000: credits = 350; break;
      case 5000: credits = 4000; break;
      default: credits = Math.floor(amount / 5); // Fallback ~10 credits per 50 rub
    }

    // Получаем пользователя
    const user = await userQueries.getByTelegramId(chatId.toString());

    // Сохраняем состояние
    await sessionService.setState(chatId, {
      state: 'WAITING_EMAIL',
      data: {
        amount: amount,
        credits: credits,
        userId: user.id
      }
    });

    await bot.sendMessage(chatId, `📧 Для отправки чека (по закону РФ), пожалуйста, введите ваш **Email**:`, { parse_mode: 'Markdown' });

    // Удаляем сообщение с кнопками, чтобы не нажали дважды
    try {
      await bot.deleteMessage(chatId, query.message.message_id);

    } catch (e) { }

    return;
  } else if (data === 'buy_method_stars') {
    // Показываем пакеты за Stars
    const keyboard = {
      inline_keyboard: [
        ...CREDIT_PACKAGES.map(pkg => [{
          text: `⭐ ${pkg.stars} Stars → ${pkg.label}`,
          callback_data: `buy_stars_${pkg.stars}`
        }]),
        [{ text: '◀️ Назад', callback_data: 'menu_buy' }]
      ]
    };
    await bot.editMessageText('Выберите пакет (оплата Telegram Stars):', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } else if (data.startsWith('buy_stars_') || data.startsWith('buy_rub_') || (data.startsWith('buy_') && !data.startsWith('buy_method_'))) {
    const isRub = data.startsWith('buy_rub_');
    // Поддержка старого формата buy_X (считаем как Stars)
    const isOldFormat = data.startsWith('buy_') && !data.startsWith('buy_stars_') && !data.startsWith('buy_rub_') && !data.startsWith('buy_method_');

    const stars = parseInt(data.split('_')[isOldFormat ? 1 : 2]);
    const package_ = CREDIT_PACKAGES.find(p => p.stars === stars);

    console.log(`💳 Попытка создать инвойс (${isRub ? 'RUB' : 'Stars'}): ${stars} Stars-eq для пользователя ${chatId}`);

    if (!package_) {
      return await bot.answerCallbackQuery(query.id, { text: '❌ Пакет не найден', show_alert: true });
    }

    try {
      const title = `${package_.credits} кредитов`;
      const description = `Пакет ${package_.description} для Nano Banana`;
      const payload = `${chatId}_${stars}_${Date.now()}_${isRub ? 'rub' : 'stars'}`;
      const currency = isRub ? 'RUB' : 'XTR';
      const prices = [{ label: title, amount: isRub ? package_.price_rub * 100 : stars }]; // RUB в копейках, XTR в единицах
      const providerToken = isRub ? YOOKASSA_PROVIDER_TOKEN : '';

      console.log('💳 Подготовка к отправке инвойса:');
      console.log('   Title:', title);
      console.log('   Payload:', payload);
      console.log('   Provider Token:', providerToken === '' ? '(empty string for Stars)' : providerToken);
      console.log('   Currency:', currency);
      console.log('   Prices:', JSON.stringify(prices));

      if (isRub && !providerToken) {
        return await bot.answerCallbackQuery(query.id, { text: '❌ Оплата картой временно недоступна (токен не настроен)', show_alert: true });
      }

      await bot.sendInvoice(
        chatId,
        title,
        description,
        payload,
        providerToken,
        currency,
        prices,
        {
          need_name: false,
          need_phone_number: false,
          need_email: false,
          need_shipping_address: false,
          is_flexible: false,
        }
      );

      console.log('✅ Инвойс успешно отправлен');
      await bot.answerCallbackQuery(query.id, { text: '💳 Инвойс отправлен!' });
    } catch (error) {
      console.error('❌ Ошибка создания инвойса:', error);
      console.error('Stack:', error.stack);
      await bot.answerCallbackQuery(query.id, { text: `❌ Ошибка: ${error.message}`, show_alert: true });
    }
  } else if (data === 'contact_support') {
    // Кнопка "Связаться с поддержкой"
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      `📞 *Связаться с поддержкой:*\n\nИспользуйте команду /support или напишите ваш вопрос здесь.\n\n${ADMIN_TELEGRAM_ID ? `Администратор: \`${ADMIN_TELEGRAM_ID}\`` : ''}`,
      { parse_mode: 'Markdown' }
    );
  } else if (data === 'show_terms') {
    // Кнопка "Условия"
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, '/terms');
  } else if (data === 'accept_terms') {
    // Кнопка "Принимаю условия"
    await bot.answerCallbackQuery(query.id, {
      text: '✅ Спасибо! Условия приняты.',
      show_alert: true
    });
  } else if (data === 'support_payment') {
    // Кнопка "Оплата" в поддержке
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, '/paysupport');
  } else if (data === 'support_generation') {
    // Кнопка "Генерация" в поддержке
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, '/help');
  }
});

// Обработка предпроверки платежа
bot.on('pre_checkout_query', async (query) => {
  console.log('🔔 PRE_CHECKOUT_QUERY ПОЛУЧЕН!');
  console.log('Query ID:', query.id);
  console.log('From user:', query.from.id, query.from.first_name);
  console.log('Currency:', query.currency);
  console.log('Total amount:', query.total_amount);
  console.log('Invoice payload:', query.invoice_payload);

  try {
    console.log('✅ Отправляем answerPreCheckoutQuery(true)...');

    const result = await bot.answerPreCheckoutQuery(query.id, true);

    console.log('✅ answerPreCheckoutQuery выполнен успешно!', result);
  } catch (error) {
    console.error('❌ Ошибка pre_checkout:', error);
    console.error('Stack:', error.stack);

    try {
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Ошибка обработки платежа. Попробуйте позже.'
      });
    } catch (e) {
      console.error('❌ Не удалось отправить отказ:', e);
    }
  }
});

// Обработка успешного платежа
bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const payment = msg.successful_payment;
  const currency = payment.currency;
  const totalAmount = payment.total_amount;

  console.log(`💰 Успешный платеж: ${totalAmount} ${currency} от пользователя ${chatId}`);

  try {
    const user = await userQueries.getByTelegramId(chatId.toString());

    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
    }

    let package_;
    if (currency === 'XTR') {
      package_ = CREDIT_PACKAGES.find(p => p.stars === totalAmount);
    } else if (currency === 'RUB') {
      // RUB amount is in kopecks (cents), so divide by 100
      const amountRub = totalAmount / 100;
      package_ = CREDIT_PACKAGES.find(p => p.price_rub === amountRub);
    }

    if (!package_) {
      console.error(`❌ Пакет не найден для ${totalAmount} ${currency}`);
      // Fallback logic if exact package not found (e.g. dynamic price?) - for now just error or give closest?
      // Let's just give error for now to be safe
      return await bot.sendMessage(chatId, '❌ Пакет не найден. Свяжитесь с поддержкой.');
    }

    // Начисляем кредиты
    await userQueries.updateCredits(package_.credits, user.id);

    // Записываем транзакцию
    await transactionQueries.create(
      user.id,
      'purchase',
      package_.credits,
      currency === 'XTR' ? totalAmount : totalAmount / 100, // Store amount in main units
      `Покупка ${package_.label} (${currency})`
    );

    const newBalance = user.credits + package_.credits;

    console.log(`✅ Кредиты начислены: ${package_.credits} → баланс: ${newBalance}`);

    const successMessage =
      `✅ *Платеж успешно обработан!*\n\n` +
      `💎 Начислено: ${package_.credits} кредитов\n` +
      `💎 Новый баланс: ${newBalance} кредитов\n\n` +
      `🎉 Спасибо за покупку!\n` +
      `Теперь вы можете генерировать еще больше контента.`;

    await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

    // Отправляем дополнительные кнопки быстрого доступа
    const quickActions = {
      inline_keyboard: [
        [{ text: '🤖 Создать текст', switch_inline_query_current_chat: '' }],
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
      '❌ Ошибка при начислении кредитов. Пожалуйста, свяжитесь с поддержкой и сообщите код ошибки: PAY_ERR_' + Date.now()
    );
  }
});

// ==================== ГЕНЕРАЦИЯ ТЕКСТА ====================

bot.on('message', async (msg) => {
  // Игнорируем команды
  if (msg.text && msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  // Команда статуса (только для админа)
  if (msg.text === '/status' && (!ADMIN_TELEGRAM_ID || chatId.toString() === ADMIN_TELEGRAM_ID.toString())) {
    try {
      const dbStatus = await userQueries.testConnection ? await userQueries.testConnection() : 'OK (Assumed)';
      const redisStatus = await sessionService.ping();

      let statusMsg = `📊 *System Status*\n\n`;
      statusMsg += `🐘 Database: ${dbStatus ? '✅ Online' : '❌ Offline'}\n`;
      statusMsg += `🔴 Redis: ${redisStatus ? '✅ Online' : '❌ Offline'}\n`;
      statusMsg += `🤖 Bot Version: 1.3 (Redis Enabled)\n`;
      statusMsg += `⏱ Uptime: ${Math.floor(process.uptime())}s`;

      return await bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
    } catch (e) {
      return await bot.sendMessage(chatId, `❌ Error checking status: ${e.message}`);
    }
  }

  const userState = await sessionService.getState(chatId);

  // Обработка ввода email для оплаты
  if (userState && userState.state === 'WAITING_EMAIL' && msg.text) {
    const email = msg.text.trim();
    // Простая валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return await bot.sendMessage(chatId, '❌ Некорректный email. Попробуйте еще раз.');
    }

    const amount = userState.data.amount;
    const credits = userState.data.credits;

    try {
      await bot.sendMessage(chatId, '⏳ Создаю платеж...');

      const payment = await yookassa.createPayment(
        amount,
        `Покупка ${credits} кредитов (Nano Banana)`,
        `https://t.me/${(await bot.getMe()).username}`, // Возврат в бота
        { userId: userState.data.userId, email: email, credits: credits }
      );

      if (payment.confirmation && payment.confirmation.confirmation_url) {
        const keyboard = {
          inline_keyboard: [
            [{ text: '💳 Оплатить', url: payment.confirmation.confirmation_url }],
            [{ text: '◀️ Отмена', callback_data: 'menu_buy' }]
          ]
        };

        await bot.sendMessage(
          chatId,
          `✅ Платеж создан!\n\n💰 Сумма: ${amount} RUB\n💎 Кредитов: ${credits}\n📧 Чек придет на: ${email}\n\nНажмите кнопку ниже для оплаты:`,
          { reply_markup: keyboard }
        );
      } else {
        await bot.sendMessage(chatId, '❌ Ошибка создания платежа (нет ссылки).');
      }

      // Сбрасываем состояние
      await sessionService.clearState(chatId);
      return;

    } catch (error) {
      console.error('Ошибка создания платежа:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при создании платежа. Попробуйте позже.');
      await sessionService.clearState(chatId);
      return;
    }
  }

  // Игнорируем системные сообщения
  if (msg.successful_payment) return;


  const prompt = msg.text || msg.caption || '';

  // Проверяем есть ли фото в сообщении
  const hasPhoto = msg.photo && msg.photo.length > 0;

  // Если есть фото И текст (любой) - это запрос на редактирование
  if (hasPhoto && prompt && prompt.trim().length > 0) {
    // ==================== РЕДАКТИРОВАНИЕ ИЗОБРАЖЕНИЯ ====================
    try {
      const user = await userQueries.getByTelegramId(chatId.toString());

      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      // Проверяем блокировку
      if (user.is_blocked) {
        return await bot.sendMessage(chatId, '❌ Ваш аккаунт заблокирован. Обратитесь в поддержку.');
      }

      // Проверяем баланс
      if (user.credits < PRICES.IMAGE_EDIT) {
        return await bot.sendMessage(
          chatId,
          `❌ Недостаточно кредитов!\n\nТребуется: ${PRICES.IMAGE_EDIT} кредитов\nУ вас: ${user.credits}\n\nИспользуйте /buy`
        );
      }

      await bot.sendChatAction(chatId, 'upload_photo');

      const statusMsg = new StatusMessage(bot, chatId);
      await statusMsg.start('✏️ Вносим правки');

      // Добавляем задачу в очередь
      console.log(`🔍 [DEBUG] Добавляю задачу редактирования в очередь...`);

      // Берем самое большое фото
      const photo = msg.photo[msg.photo.length - 1];

      await generationQueue.add('edit-image', {
        chatId,
        prompt,
        userId: user.id,
        messageId: msg.message_id,
        fileId: photo.file_id,
        statusMessageId: statusMsg.messageId
      });

      console.log(`✅ [DEBUG] Задача редактирования добавлена в очередь`);

      // Статус "Вносим правки" останется висеть, пока воркер не ответит
      return;

    } catch (error) {
      console.error('Ошибка редактирования изображения:', error);
      if (typeof statusMsg !== 'undefined') await statusMsg.stop();
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
    const user = await userQueries.getByTelegramId(chatId.toString());

    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    // Проверяем блокировку
    if (user.is_blocked) {
      return await bot.sendMessage(chatId, '❌ Ваш аккаунт заблокирован. Обратитесь в поддержку.');
    }

    // Проверяем баланс
    if (user.credits <= 0) {
      return await bot.sendMessage(
        chatId,
        '❌ У вас недостаточно кредитов!\n\nИспользуйте /buy для покупки кредитов.'
      );
    }

    // Проверяем, это запрос на генерацию изображения?
    const isImageRequest = ImageService.isImageRequest(prompt);

    if (isImageRequest) {
      // Генерация изображения
      await bot.sendChatAction(chatId, 'upload_photo');

      const imagePrompt = ImageService.extractImagePrompt(prompt);
      console.log(`🎨 Запрос на генерацию изображения: "${imagePrompt}"`);

      const statusMsg = new StatusMessage(bot, chatId);
      await statusMsg.start('🎨 Рисую');

      try {
        const creditsUsed = PRICES.IMAGE_GEN;

        // Проверяем баланс
        if (user.credits < creditsUsed) {
          await statusMsg.stop();
          return await bot.sendMessage(
            chatId,
            `❌ Недостаточно кредитов.\n\nТребуется: ${creditsUsed}\nДоступно: ${user.credits}\n\nИспользуйте /buy`
          );
        }

        // Добавляем задачу в очередь
        console.log(`🔍 [DEBUG] Добавляю задачу в очередь 'image-generation'...`);
        console.log(`🔍 [DEBUG] Redis URL (Bot): ${process.env.REDIS_URL || 'default localhost'}`);

        await generationQueue.add('generate-image', {
          chatId,
          prompt: imagePrompt,
          userId: user.id,
          messageId: msg.message_id,
          statusMessageId: statusMsg.messageId // Передаем ID статус-сообщения для удаления
        });

        console.log(`✅ [DEBUG] Задача успешно добавлена в очередь (Job ID будет присвоен BullMQ)`);

        // Статус "Рисую" останется висеть, пока воркер не ответит
        // Воркер сам отправит результат или ошибку и удалит статус-сообщение

      } catch (e) {
        await statusMsg.stop();
        throw e;
      }
    } else {
      // Обычная генерация текста
      const statusMsg = new StatusMessage(bot, chatId);
      await statusMsg.start('🤔 Думаю');

      try {
        const result = await gemini.generate(prompt);

        // Определяем стоимость на основе длины ответа
        const responseLength = result.text.length;
        const creditsUsed = responseLength > 500 ? PRICES.TEXT_LONG : PRICES.TEXT_SHORT;

        // Проверяем, хватит ли кредитов
        if (user.credits < creditsUsed) {
          await statusMsg.stop();
          return await bot.sendMessage(
            chatId,
            `❌ Недостаточно кредитов для этого запроса.\n\nТребуется: ${creditsUsed}\nДоступно: ${user.credits}\n\nИспользуйте /buy`
          );
        }

        // Списываем кредиты
        await userQueries.updateCredits(-creditsUsed, user.id);
        await userQueries.incrementGenerations(creditsUsed, user.id);

        await generationQueries.create(user.id, prompt, result.text, creditsUsed, 'text', null);
        await transactionQueries.create(user.id, 'generation', -creditsUsed, 0, 'Генерация текста');

        const newBalance = user.credits - creditsUsed;

        await statusMsg.stop();

        // Отправляем ответ (используем sendSmartMessage для длинных текстов)
        const footer = `\n\n---\n💎 Использовано: ${creditsUsed} ${creditsUsed === 1 ? 'кредит' : 'кредита/кредитов'}\n💎 Осталось: ${newBalance}`;
        await sendSmartMessage(
          chatId,
          result.text + footer
        );
      } catch (e) {
        await statusMsg.stop();
        throw e;
      }
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

