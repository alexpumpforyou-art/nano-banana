const TelegramBot = require('node-telegram-bot-api');
const { userQueries, transactionQueries, generationQueries, referralQueries, generateReferralCode } = require('./database');
const GeminiService = require('./gemini-service');
const ImageService = require('./image-service');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const gemini = new GeminiService(process.env.GEMINI_API_KEY);
const imageService = new ImageService(process.env.GEMINI_API_KEY);

// Новая система кредитов (деноминация: 50 токенов = 1 кредит)
const FREE_CREDITS = parseInt(process.env.FREE_CREDITS) || 10; // было 100-200 токенов = 2-4 кредита
const CREDITS_PER_STAR = parseInt(process.env.CREDITS_PER_STAR) || 40; // было 2000 токенов = 40 кредитов
const REFERRAL_BONUS = parseInt(process.env.REFERRAL_BONUS) || 5; // бонус за реферала
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// Цены на операции (в кредитах)
const PRICES = {
  TEXT_SHORT: 1,      // короткий текст (до 500 символов) - было 40-60 токенов
  TEXT_LONG: 2,       // длинный текст (500+ символов)
  IMAGE_GEN: 10,      // генерация изображения - было 1000-3000 токенов
  IMAGE_EDIT: 15      // редактирование изображения - было 1500-4000 токенов
};

// Генерируем пакеты кредитов динамически на основе CREDITS_PER_STAR
const CREDIT_PACKAGES = [
  { 
    stars: 1, 
    credits: CREDITS_PER_STAR * 1, 
    label: `${CREDITS_PER_STAR} кредитов`,
    description: 'Базовый' 
  },
  { 
    stars: 5, 
    credits: Math.floor(CREDITS_PER_STAR * 5 * 1.1), 
    label: `${Math.floor(CREDITS_PER_STAR * 5 * 1.1)} кредитов`,
    description: '+10% 💎' 
  },
  { 
    stars: 10, 
    credits: Math.floor(CREDITS_PER_STAR * 10 * 1.2), 
    label: `${Math.floor(CREDITS_PER_STAR * 10 * 1.2)} кредитов`,
    description: '+20% 💎' 
  },
  { 
    stars: 25, 
    credits: Math.floor(CREDITS_PER_STAR * 25 * 1.3), 
    label: `${Math.floor(CREDITS_PER_STAR * 25 * 1.3)} кредитов`,
    description: '+30% 💎' 
  },
  { 
    stars: 50, 
    credits: Math.floor(CREDITS_PER_STAR * 50 * 1.5), 
    label: `${Math.floor(CREDITS_PER_STAR * 50 * 1.5)} кредитов`,
    description: '+50% 🔥' 
  },
];

// Для удаления старых сообщений
const userLastMessages = new Map(); // chatId -> [messageIds]

// Функция удаления старых сообщений
async function deleteOldMessages(chatId) {
  const messages = userLastMessages.get(chatId) || [];
  for (const msgId of messages) {
    try {
      await bot.deleteMessage(chatId, msgId);
    } catch (e) {
      // Игнорируем ошибки удаления (сообщение уже удалено или слишком старое)
    }
  }
  userLastMessages.set(chatId, []);
}

// Функция отправки сообщения с запоминанием ID
async function sendAndRemember(chatId, text, options = {}) {
  const sentMsg = await bot.sendMessage(chatId, text, options);
  const messages = userLastMessages.get(chatId) || [];
  messages.push(sentMsg.message_id);
  userLastMessages.set(chatId, messages);
  return sentMsg;
}

// ==================== КОМАНДЫ ====================

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const referralCode = match && match[1] ? match[1].trim() : null;

  try {
    await deleteOldMessages(chatId); // Удаляем старые сообщения
    
    let user = userQueries.getByTelegramId.get(chatId.toString());
    let isNewUser = false;
    
    if (!user) {
      // Новый пользователь - создаем с реферальным кодом
      const newReferralCode = generateReferralCode();
      user = userQueries.getOrCreateTelegramUser.get(
        chatId.toString(),
        username,
        FREE_CREDITS,
        newReferralCode
      );
      isNewUser = true;
      
      // Если пришел по реферальной ссылке
      if (referralCode) {
        const referrer = userQueries.getByReferralCode.get(referralCode);
        if (referrer && referrer.telegram_id !== chatId.toString()) {
          // Устанавливаем реферера
          userQueries.setReferrer.run(referrer.id, user.id);
          
          // Начисляем бонус рефереру
          userQueries.addReferralBonus.run(REFERRAL_BONUS, REFERRAL_BONUS, referrer.id);
          
          // Записываем в таблицу рефералов
          referralQueries.create.run(referrer.id, user.id, REFERRAL_BONUS);
          
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

    const welcomeText = `
🍌 ${isNewUser ? 'Добро пожаловать' : 'С возвращением'} в Nano Banana!

💎 Ваш баланс: *${user.credits} кредитов*
📊 Генераций: ${user.total_generations || 0}
${user.referral_code ? `\n🔗 Пригласите друзей и получите бонусы!` : ''}

📝 Отправьте мне текст для генерации или выберите действие:
    `;

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

    await sendAndRemember(chatId, welcomeText, { reply_markup: keyboard, parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Ошибка в /start:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при инициализации.');
  }
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await deleteOldMessages(chatId);
    
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const refCount = userQueries.countReferrals.get(user.id);
    
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
    
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const keyboard = {
      inline_keyboard: CREDIT_PACKAGES.map(pkg => [{
        text: `⭐ ${pkg.stars} Stars → ${pkg.credits} ${pkg.description}`,
        callback_data: `buy_${pkg.stars}`
      }])
    };

    const priceInfo = `💰 *Магазин кредитов*\n\n` +
      `💎 Ваш баланс: ${user.credits} кредитов\n\n` +
      `📊 Стоимость операций:\n` +
      `• Текст (короткий): ${PRICES.TEXT_SHORT} кредит\n` +
      `• Текст (длинный): ${PRICES.TEXT_LONG} кредита\n` +
      `• Генерация изображения: ${PRICES.IMAGE_GEN} кредитов (скоро)\n` +
      `• Редактирование: ${PRICES.IMAGE_EDIT} кредитов (скоро)\n\n` +
      `🎁 Больше покупаете = больше бонусов!`;

    const sentMsg = await bot.sendMessage(
      chatId,
      priceInfo,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
    
    const messages = userLastMessages.get(chatId) || [];
    messages.push(sentMsg.message_id);
    userLastMessages.set(chatId, messages);
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
      SELECT COUNT(*) as count, SUM(credits_used) as total_credits 
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
    const estimatedRevenue = (totalPurchases.total_stars || 0) * 0.01; // $0.01 за Star
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
    
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
    }

    const referrals = userQueries.getReferrals.all(user.id);
    const refCount = referrals.length;
    
    let referralText = `
👥 *Реферальная программа*

🔗 Ваша реферальная ссылка:
\`t.me/${(await bot.getMe()).username}?start=${user.referral_code}\`

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
    
    const user = userQueries.getByTelegramId.get(targetTelegramId);
    
    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    const refCount = userQueries.countReferrals.get(user.id);
    
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
    
    const user = userQueries.getByTelegramId.get(targetTelegramId);
    
    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    userQueries.updateCredits.run(creditsToAdd, user.id);
    transactionQueries.create.run(user.id, 'admin_bonus', creditsToAdd, 0, 'Начислено администратором');

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
    
    const user = userQueries.getByTelegramId.get(targetTelegramId);
    
    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    userQueries.setBlocked.run(1, user.id);
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
    
    const user = userQueries.getByTelegramId.get(targetTelegramId);
    
    if (!user) {
      return await bot.sendMessage(chatId, '❌ Пользователь не найден.');
    }

    userQueries.setBlocked.run(0, user.id);
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
    try {
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const refCount = userQueries.countReferrals.get(user.id);
      
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
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const keyboard = {
        inline_keyboard: [
          ...CREDIT_PACKAGES.map(pkg => [{
            text: `⭐ ${pkg.stars} Stars → ${pkg.credits} ${pkg.description}`,
            callback_data: `buy_${pkg.stars}`
          }]),
          [{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]
        ]
      };

      const priceInfo = `💰 *Магазин кредитов*\n\n` +
        `💎 Ваш баланс: ${user.credits} кредитов\n\n` +
        `📊 Стоимость операций:\n` +
        `• Текст (короткий): ${PRICES.TEXT_SHORT} кредит\n` +
        `• Текст (длинный): ${PRICES.TEXT_LONG} кредита\n` +
        `• Генерация изображения: ${PRICES.IMAGE_GEN} кредитов (скоро)\n\n` +
        `🎁 Больше покупаете = больше бонусов!`;

      await bot.answerCallbackQuery(query.id);
      const sentMsg = await bot.sendMessage(chatId, priceInfo, { reply_markup: keyboard, parse_mode: 'Markdown' });
      
      const messages = userLastMessages.get(chatId) || [];
      messages.push(sentMsg.message_id);
      userLastMessages.set(chatId, messages);
    } catch (error) {
      console.error('Ошибка menu_buy:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data === 'menu_referral') {
    try {
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const referrals = userQueries.getReferrals.all(user.id);
      const refCount = referrals.length;
      
      let referralText = `
👥 *Реферальная программа*

🔗 Ваша реферальная ссылка:
\`t.me/${(await bot.getMe()).username}?start=${user.referral_code}\`

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
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      if (!user) {
        return await bot.sendMessage(chatId, 'Используйте /start для начала работы.');
      }

      const history = generationQueries.getHistory.all(user.id, 5);

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

📝 *Как использовать:*
1. Отправьте текст для генерации ответа
2. Нажмите "🎨 Генерация изображений" для создания картинок (скоро)

💎 *Токены:*
- Новые пользователи: ${FREE_CREDITS} кредитов
- Покупайте через кнопку "💰 Купить кредиты"
- 1 Star = ${CREDITS_PER_STAR} кредитов

🎨 *Возможности:*
• Генерация текста (1-2 кредита)
• Создание изображений (скоро)
• Редактирование изображений (скоро)

👥 *Рефералы:*
Приглашайте друзей и получайте ${REFERRAL_BONUS} кредитов за каждого!
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
      
      const db = require('./database');
      
      const totalUsers = db.db.prepare('SELECT COUNT(*) as count FROM users').get();
      const totalPurchases = db.db.prepare(`SELECT COUNT(*) as count, SUM(amount) as total_stars FROM transactions WHERE type = 'purchase'`).get();
      const totalGenerations = db.db.prepare(`SELECT COUNT(*) as count, SUM(credits_used) as total_credits FROM generations`).get();
      const recentGens = db.db.prepare(`SELECT COUNT(*) as count FROM generations WHERE created_at > datetime('now', '-1 day')`).get();
      
      const avgPurchase = totalPurchases.total_stars && totalPurchases.count ? (totalPurchases.total_stars / totalPurchases.count).toFixed(1) : 0;
      const estimatedRevenue = (totalPurchases.total_stars || 0) * 0.01;
      const estimatedCost = ((totalGenerations.total_credits || 0) * 50 / 1000000) * 0.15;
      const estimatedProfit = estimatedRevenue - estimatedCost;
      
      let statsText = `📊 *Статистика Nano Banana*\n\n`;
      statsText += `👥 Пользователей: ${totalUsers.count}\n\n`;
      statsText += `💰 *Продажи:*\n`;
      statsText += `└ Покупок: ${totalPurchases.count || 0}\n`;
      statsText += `└ Заработано: ${totalPurchases.total_stars || 0} ⭐\n`;
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
      
      const user = userQueries.getByTelegramId.get(chatId.toString());
      
      const welcomeText = `
🍌 С возвращением в Nano Banana!

💎 Ваш баланс: *${user.credits} кредитов*
📊 Генераций: ${user.total_generations || 0}

📝 Отправьте мне текст для генерации или выберите действие:
      `;

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

      await sendAndRemember(chatId, welcomeText, { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Ошибка menu_back:', error);
    }
  } else if (data === 'check_balance') {
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
        text: `💎 Ваш баланс: ${user.credits} кредитов`, 
        show_alert: true 
      });
    } catch (error) {
      console.error('Ошибка проверки баланса:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  } else if (data.startsWith('buy_')) {
    const stars = parseInt(data.split('_')[1]);
    const package_ = CREDIT_PACKAGES.find(p => p.stars === stars);

    console.log(`💳 Попытка создать инвойс: ${stars} Stars для пользователя ${chatId}`);

    if (!package_) {
      console.error(`❌ Пакет не найден для ${stars} Stars`);
      return await bot.answerCallbackQuery(query.id, { text: '❌ Пакет не найден', show_alert: true });
    }

    try {
      console.log(`📦 Создаем инвойс для пакета:`, package_);
      
      // Отправляем инвойс для оплаты Stars
      const invoice = await bot.sendInvoice(
        chatId,
        `${package_.credits} кредитов`, // title (max 32 chars)
        `Пакет ${package_.description} для Nano Banana`, // description (max 255 chars)
        `${chatId}_${stars}_${Date.now()}`, // payload
        '', // provider_token пустой для Stars
        'XTR', // валюта Telegram Stars
        [{ label: `${package_.credits} кредитов`, amount: stars }], // prices
        {
          need_name: false,
          need_phone_number: false,
          need_email: false,
          need_shipping_address: false,
          is_flexible: false,
        }
      );

      console.log(`✅ Инвойс создан успешно!`);
      console.log('   Message ID:', invoice.message_id);
      console.log('   Chat ID:', invoice.chat.id);
      console.log('   ⚠️ ВАЖНО: Теперь ждем pre_checkout_query от пользователя...');
      
      await bot.answerCallbackQuery(query.id, { text: '💳 Инвойс отправлен! Проверьте чат.' });
    } catch (error) {
      console.error('❌ Ошибка создания инвойса:', error);
      console.error('Детали:', error.response?.body || error.message);
      console.error('Stack:', error.stack);
      
      await bot.answerCallbackQuery(query.id, { 
        text: `❌ Ошибка: ${error.message}`, 
        show_alert: true 
      });
    }
  }
});

// Обработка предпроверки платежа
bot.on('pre_checkout_query', async (query) => {
  console.log('🔔 PRE_CHECKOUT_QUERY ПОЛУЧЕН!');
  console.log('Query ID:', query.id);
  console.log('From user:', query.from.id);
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
  const stars = msg.successful_payment.total_amount;

  console.log(`💰 Успешный платеж: ${stars} Stars от пользователя ${chatId}`);

  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!user) {
      console.error(`❌ Пользователь ${chatId} не найден после успешной оплаты`);
      return await bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
    }

    const package_ = CREDIT_PACKAGES.find(p => p.stars === stars);
    
    if (!package_) {
      console.error(`❌ Пакет не найден для ${stars} Stars`);
      return await bot.sendMessage(chatId, '❌ Пакет не найден.');
    }

    // Начисляем кредиты
    userQueries.updateCredits.run(package_.credits, user.id);

    // Записываем транзакцию
    transactionQueries.create.run(
      user.id,
      'purchase',
      package_.credits,
      stars,
      `Покупка ${package_.label}`
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
      
      const creditsUsed = PRICES.IMAGE_EDIT;
      
      // Списываем кредиты
      userQueries.updateCredits.run(-creditsUsed, user.id);
      userQueries.incrementGenerations.run(creditsUsed, user.id);
      
      // Сохраняем
      generationQueries.create.run(user.id, `[Редактирование] ${prompt}`, '[Изображение]', creditsUsed, 'image_edit');
      transactionQueries.create.run(user.id, 'generation', -creditsUsed, 0, 'Редактирование изображения');
      
      const newBalance = user.credits - creditsUsed;
      
      // Отправляем отредактированное изображение
      try {
        await bot.sendPhoto(chatId, result.imageBuffer, {
          caption: `✏️ Изображение отредактировано!\n\n💎 Использовано: ${creditsUsed} кредитов\n💎 Осталось: ${newBalance}`
        });
      } catch (photoError) {
        console.error('Ошибка отправки фото:', photoError);
        await bot.sendMessage(
          chatId,
          `✏️ Изображение отредактировано, но ошибка при отправке.\n\n💎 Использовано: ${creditsUsed} кредитов\n💎 Осталось: ${newBalance}`
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
      
      const creditsUsed = PRICES.IMAGE_GEN;
      
      // Проверяем баланс
      if (user.credits < creditsUsed) {
        return await bot.sendMessage(
          chatId,
          `❌ Недостаточно кредитов.\n\nТребуется: ${creditsUsed}\nДоступно: ${user.credits}\n\nИспользуйте /buy`
        );
      }
      
      const result = await imageService.generateImage(imagePrompt);
      
      // Списываем кредиты
      userQueries.updateCredits.run(-creditsUsed, user.id);
      userQueries.incrementGenerations.run(creditsUsed, user.id);
      
      // Сохраняем генерацию
      generationQueries.create.run(user.id, prompt, '[Изображение]', creditsUsed, 'image');
      
      // Сохраняем транзакцию
      transactionQueries.create.run(
        user.id,
        'generation',
        -creditsUsed,
        0,
        'Генерация изображения'
      );
      
      const newBalance = user.credits - creditsUsed;
      
      // Отправляем изображение
      try {
        await bot.sendPhoto(chatId, result.imageBuffer, {
          caption: `🎨 Изображение сгенерировано!\n\n💎 Использовано: ${creditsUsed} кредитов\n💎 Осталось: ${newBalance}`
        });
      } catch (photoError) {
        console.error('Ошибка отправки фото:', photoError);
        await bot.sendMessage(
          chatId,
          `🎨 Изображение сгенерировано, но произошла ошибка при отправке.\n\nОшибка: ${photoError.message}\n\n💎 Использовано: ${creditsUsed} кредитов\n💎 Осталось: ${newBalance}`
        );
      }
    } else {
      // Обычная генерация текста
      await bot.sendChatAction(chatId, 'typing');
      
      const result = await gemini.generate(prompt);
      
      // Определяем стоимость на основе длины ответа
      const responseLength = result.text.length;
      const creditsUsed = responseLength > 500 ? PRICES.TEXT_LONG : PRICES.TEXT_SHORT;
      
      // Проверяем, хватит ли кредитов
      if (user.credits < creditsUsed) {
        return await bot.sendMessage(
          chatId,
          `❌ Недостаточно кредитов для этого запроса.\n\nТребуется: ${creditsUsed}\nДоступно: ${user.credits}\n\nИспользуйте /buy`
        );
      }
      
      // Списываем кредиты
      userQueries.updateCredits.run(-creditsUsed, user.id);
      userQueries.incrementGenerations.run(creditsUsed, user.id);
      
      // Сохраняем генерацию
      generationQueries.create.run(user.id, prompt, result.text, creditsUsed, 'text');
      
      // Сохраняем транзакцию
      transactionQueries.create.run(
        user.id,
        'generation',
        -creditsUsed,
        0,
        'Генерация текста'
      );
      
      const newBalance = user.credits - creditsUsed;
      
      // Отправляем ответ
      await bot.sendMessage(
        chatId,
        `${result.text}\n\n---\n💎 Использовано: ${creditsUsed} ${creditsUsed === 1 ? 'кредит' : 'кредита/кредитов'}\n💎 Осталось: ${newBalance}`
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

