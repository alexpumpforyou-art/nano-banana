# 🎨 Руководство по кастомизации Nano Banana Bot

Полное руководство по настройке и изменению вашего Telegram-бота для генерации изображений и текста.

---

## 📁 Структура проекта

```
nano-banana/
├── telegram-bot.js       # Основная логика Telegram бота
├── gemini-service.js     # Работа с Gemini AI для текста
├── image-service.js      # Генерация и редактирование изображений
├── database.js           # База данных SQLite
├── server.js             # Web-сервер (веб-интерфейс)
├── .env                  # Настройки (НЕ заливать в git!)
├── env.template          # Шаблон настроек
└── public/               # Веб-интерфейс (HTML/CSS/JS)
```

---

## 🎯 Основные настройки бота

### 📍 Файл: `telegram-bot.js` (строки 11-23)

```javascript
// Настройки кредитов
const FREE_CREDITS = 10;           // Бесплатные кредиты новым пользователям
const CREDITS_PER_STAR = 40;       // Сколько кредитов за 1 Star
const REFERRAL_BONUS = 5;          // Бонус за приглашенного друга

// Цены на операции (в кредитах)
const PRICES = {
  TEXT_SHORT: 1,      // Короткий текст (до 500 символов)
  TEXT_LONG: 2,       // Длинный текст (500+ символов)
  IMAGE_GEN: 10,      // Генерация изображения
  IMAGE_EDIT: 15      // Редактирование изображения
};
```

**Как изменить:**
1. Откройте `telegram-bot.js`
2. Найдите эти строки (11-23)
3. Измените цифры на нужные
4. Сохраните файл

**Пример:** Хотите дать новым пользователям 50 кредитов вместо 10?
```javascript
const FREE_CREDITS = 50;  // Было: 10
```

---

## 🎨 Добавление примеров сгенерированных изображений

### Вариант 1: Галерея в команде /start

**Файл:** `telegram-bot.js`, команда `/start` (строка ~86)

Добавьте кнопку "🖼 Примеры работ" в главное меню:

```javascript
const keyboard = {
  inline_keyboard: [
    [
      { text: '🎨 Генерация изображений', callback_data: 'menu_image' },
      { text: '💎 Баланс', callback_data: 'menu_balance' }
    ],
    [
      { text: '🖼 Примеры работ', callback_data: 'menu_examples' },  // ← НОВАЯ КНОПКА
      { text: '💰 Купить кредиты', callback_data: 'menu_buy' }
    ],
    // ... остальные кнопки
  ]
};
```

Затем добавьте обработчик (в раздел `bot.on('callback_query')` около строки 650):

```javascript
} else if (data === 'menu_examples') {
  try {
    await bot.answerCallbackQuery(query.id);
    
    // Отправляем примеры изображений
    await bot.sendPhoto(chatId, 'https://example.com/image1.jpg', {
      caption: '🎨 Пример 1: "Космический кот в шлеме"\n\n💡 Промпт: "нарисуй кота в космическом шлеме на фоне звезд"'
    });
    
    await bot.sendPhoto(chatId, 'https://example.com/image2.jpg', {
      caption: '🎨 Пример 2: "Закат в горах"\n\n💡 Промпт: "красивый закат в горах, реалистичный стиль"'
    });
    
    const backButton = {
      inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]]
    };
    
    await bot.sendMessage(chatId, '✨ Вот что можно создать с Nano Banana!', {
      reply_markup: backButton
    });
  } catch (error) {
    console.error('Ошибка menu_examples:', error);
  }
}
```

**Где взять ссылки на изображения:**
1. Загрузите примеры в Telegram-канал (можно приватный)
2. Получите прямые ссылки на файлы
3. Или используйте `file_id` из Telegram

**Альтернатива - отправка файлов из папки:**
```javascript
await bot.sendPhoto(chatId, './examples/example1.jpg', {
  caption: 'Пример работы'
});
```

---

### Вариант 2: Автоматические примеры при первом запуске

Добавьте в команду `/start` после приветствия:

```javascript
// После отправки приветственного сообщения
if (isNewUser) {
  // Показываем примеры новым пользователям
  await bot.sendMessage(chatId, '✨ Вот несколько примеров что я могу создать:');
  
  await bot.sendPhoto(chatId, 'FILE_ID_OR_URL', {
    caption: '🎨 "Футуристический город"\nПромпт: нарисуй футуристический город с летающими машинами'
  });
  
  await bot.sendPhoto(chatId, 'FILE_ID_OR_URL', {
    caption: '🎨 "Милый щенок"\nПромпт: нарисуй милого щенка золотистого ретривера'
  });
}
```

---

## 💡 Добавление готовых промптов (быстрые кнопки)

### Метод 1: Кнопки с готовыми промптами в меню изображений

**Файл:** `telegram-bot.js`, обработчик `menu_image` (около строки 803)

Измените текст и добавьте кнопки с промптами:

```javascript
} else if (data === 'menu_image') {
  const imageText = `
🎨 *Генерация изображений*

✅ *Быстрые промпты:*
Нажмите кнопку или напишите свой запрос!

💎 *Цены:*
• Генерация: ${PRICES.IMAGE_GEN} кредитов
• Редактирование: ${PRICES.IMAGE_EDIT} кредитов
  `;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🐱 Милый котик', callback_data: 'prompt_cat' },
        { text: '🌆 Город будущего', callback_data: 'prompt_city' }
      ],
      [
        { text: '🌅 Закат в горах', callback_data: 'prompt_sunset' },
        { text: '🚀 Космос', callback_data: 'prompt_space' }
      ],
      [
        { text: '🎨 Абстракция', callback_data: 'prompt_abstract' },
        { text: '🏝 Тропический рай', callback_data: 'prompt_tropical' }
      ],
      [{ text: '◀️ Назад в меню', callback_data: 'menu_back' }]
    ]
  };

  await bot.answerCallbackQuery(query.id);
  await sendAndRemember(chatId, imageText, { parse_mode: 'Markdown', reply_markup: keyboard });
}
```

Затем добавьте обработчики для каждого промпта:

```javascript
} else if (data.startsWith('prompt_')) {
  await bot.answerCallbackQuery(query.id);
  
  const prompts = {
    'prompt_cat': 'милый котик с большими глазами, мультяшный стиль',
    'prompt_city': 'футуристический город с небоскребами и летающими машинами, ночь, неоновые огни',
    'prompt_sunset': 'красивый закат в горах, реалистичный стиль, облака',
    'prompt_space': 'космический пейзаж с планетами и звездами, темный космос',
    'prompt_abstract': 'абстрактная композиция с яркими цветами, современное искусство',
    'prompt_tropical': 'тропический пляж с пальмами, бирюзовая вода, солнечный день'
  };
  
  const promptText = prompts[data];
  
  if (promptText) {
    await bot.sendMessage(chatId, `🎨 Генерирую: "${promptText}"\n\n⏳ Подождите немного...`);
    
    // Запускаем генерацию
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    // Проверяем баланс
    if (user.credits < PRICES.IMAGE_GEN) {
      return await bot.sendMessage(
        chatId,
        `❌ Недостаточно кредитов!\n\nТребуется: ${PRICES.IMAGE_GEN}\nУ вас: ${user.credits}\n\nИспользуйте /buy`
      );
    }
    
    try {
      const result = await imageService.generateImage(promptText);
      
      // Списываем кредиты
      userQueries.updateCredits.run(-PRICES.IMAGE_GEN, user.id);
      userQueries.incrementGenerations.run(PRICES.IMAGE_GEN, user.id);
      
      // Сохраняем в историю
      generationQueries.create.run(user.id, `[Промпт] ${promptText}`, '[Изображение]', PRICES.IMAGE_GEN, 'image');
      transactionQueries.create.run(user.id, 'generation', -PRICES.IMAGE_GEN, 0, 'Генерация изображения');
      
      const newBalance = user.credits - PRICES.IMAGE_GEN;
      
      await bot.sendPhoto(chatId, result.imageBuffer, {
        caption: `🎨 Изображение готово!\n\n💎 Использовано: ${PRICES.IMAGE_GEN} кредитов\n💎 Осталось: ${newBalance}`
      });
    } catch (error) {
      console.error('Ошибка генерации по промпту:', error);
      await bot.sendMessage(chatId, '❌ Ошибка генерации. Попробуйте еще раз.');
    }
  }
}
```

---

### Метод 2: Категории промптов с подменю

Создайте многоуровневое меню:

```javascript
} else if (data === 'menu_image') {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🎨 Искусство', callback_data: 'category_art' },
        { text: '🐾 Животные', callback_data: 'category_animals' }
      ],
      [
        { text: '🏞 Природа', callback_data: 'category_nature' },
        { text: '🏙 Города', callback_data: 'category_cities' }
      ],
      [
        { text: '🚀 Фантастика', callback_data: 'category_scifi' },
        { text: '✨ Другое', callback_data: 'category_other' }
      ],
      [{ text: '◀️ Назад', callback_data: 'menu_back' }]
    ]
  };
  
  await bot.answerCallbackQuery(query.id);
  await sendAndRemember(chatId, '🎨 *Выберите категорию:*', { 
    parse_mode: 'Markdown', 
    reply_markup: keyboard 
  });
  
} else if (data === 'category_animals') {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🐱 Кот', callback_data: 'prompt_cat' },
        { text: '🐶 Собака', callback_data: 'prompt_dog' }
      ],
      [
        { text: '🦁 Лев', callback_data: 'prompt_lion' },
        { text: '🐧 Пингвин', callback_data: 'prompt_penguin' }
      ],
      [{ text: '◀️ Назад к категориям', callback_data: 'menu_image' }]
    ]
  };
  
  await bot.answerCallbackQuery(query.id);
  await sendAndRemember(chatId, '🐾 *Животные - выберите промпт:*', {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}
```

---

## 🎁 Добавление приветственного бонуса

Дайте пользователям дополнительные кредиты за определенные действия:

### Бонус за подписку на канал

**Файл:** `telegram-bot.js`, добавьте новую команду:

```javascript
bot.onText(/\/subscribe/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    // Проверяем подписан ли пользователь
    const channelUsername = '@your_channel'; // Ваш канал
    const member = await bot.getChatMember(channelUsername, chatId);
    
    if (['member', 'administrator', 'creator'].includes(member.status)) {
      // Проверяем получал ли уже бонус
      const alreadyGot = transactionQueries.getHistory.all(user.id, 100)
        .some(t => t.description === 'Бонус за подписку');
      
      if (alreadyGot) {
        return await bot.sendMessage(chatId, '❌ Вы уже получили бонус за подписку!');
      }
      
      // Начисляем бонус
      const bonus = 20;
      userQueries.updateCredits.run(bonus, user.id);
      transactionQueries.create.run(user.id, 'bonus', bonus, 0, 'Бонус за подписку');
      
      await bot.sendMessage(
        chatId,
        `🎉 Спасибо за подписку!\n\n💎 Вам начислено ${bonus} кредитов!\n💰 Ваш баланс: ${user.credits + bonus}`
      );
    } else {
      await bot.sendMessage(
        chatId,
        `❌ Вы не подписаны на наш канал!\n\nПодпишитесь: ${channelUsername}\nЗатем используйте /subscribe снова.`
      );
    }
  } catch (error) {
    console.error('Ошибка /subscribe:', error);
    await bot.sendMessage(chatId, '❌ Ошибка проверки подписки.');
  }
});
```

---

## 🎯 Изменение текстов приветствия и помощи

### Приветственное сообщение

**Файл:** `telegram-bot.js`, команда `/start` (строка ~134)

```javascript
const welcomeText = `
🍌 ${isNewUser ? 'Добро пожаловать' : 'С возвращением'} в Nano Banana!

💎 Ваш баланс: *${user.credits} кредитов*
📊 Генераций: ${user.total_generations || 0}
${user.referral_code ? `\n🔗 Пригласите друзей и получите бонусы!` : ''}

📝 Отправьте мне текст для генерации или выберите действие:
`;
```

**Измените на свой текст:**
```javascript
const welcomeText = `
👋 Привет, ${msg.from.first_name}!

Я - твой личный AI-художник! 🎨

💰 У тебя ${user.credits} кредитов
🎁 Новичкам - первые 3 генерации бесплатно!

Напиши что нарисовать или выбери готовый промпт ⬇️
`;
```

---

### Сообщение помощи

**Файл:** `telegram-bot.js`, обработчик `menu_help` (строка ~766)

Измените текст на свой:

```javascript
const helpText = `
🍌 *Nano Banana - Помощь*

📝 *Как использовать:*
1. Напишите что хотите создать
2. Бот сгенерирует изображение за 10 кредитов
3. Можете редактировать - отправьте фото + описание изменений

💎 *Цены:*
• Текст: ${PRICES.TEXT_SHORT}-${PRICES.TEXT_LONG} кредита
• Изображение: ${PRICES.IMAGE_GEN} кредитов
• Редактирование: ${PRICES.IMAGE_EDIT} кредитов

🎁 *Как получить кредиты:*
• Пригласите друзей (+${REFERRAL_BONUS} кредитов за каждого)
• Купите через Telegram Stars

💡 *Советы:*
• Пишите промпты подробно
• Указывайте стиль (реалистичный, мультяшный, и т.д.)
• Используйте готовые промпты из меню

❓ Вопросы? Напишите @ваш_username
`;
```

---

## 🛠 Добавление команды промокодов

**Файл:** `telegram-bot.js`, добавьте в конец перед экспортом:

```javascript
// Система промокодов
const promoCodes = new Map(); // Храним промокоды в памяти (можно перенести в БД)

// Админ: создать промокод
bot.onText(/\/createpromo\s+(\S+)\s+(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!ADMIN_TELEGRAM_ID || chatId.toString() !== ADMIN_TELEGRAM_ID) {
    return;
  }
  
  const promoCode = match[1].toUpperCase();
  const credits = parseInt(match[2]);
  
  promoCodes.set(promoCode, {
    credits: credits,
    usedBy: []
  });
  
  await bot.sendMessage(
    chatId,
    `✅ Промокод создан!\n\n🎟 Код: \`${promoCode}\`\n💎 Кредитов: ${credits}\n\nПользователи могут активировать: /promo ${promoCode}`,
    { parse_mode: 'Markdown' }
  );
});

// Пользователь: активировать промокод
bot.onText(/\/promo\s+(\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const promoCode = match[1].toUpperCase();
  
  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    if (!promoCodes.has(promoCode)) {
      return await bot.sendMessage(chatId, '❌ Промокод не найден или уже недействителен.');
    }
    
    const promo = promoCodes.get(promoCode);
    
    // Проверяем использовал ли уже
    if (promo.usedBy.includes(user.id)) {
      return await bot.sendMessage(chatId, '❌ Вы уже использовали этот промокод!');
    }
    
    // Начисляем кредиты
    userQueries.updateCredits.run(promo.credits, user.id);
    transactionQueries.create.run(user.id, 'promo', promo.credits, 0, `Промокод: ${promoCode}`);
    
    promo.usedBy.push(user.id);
    
    await bot.sendMessage(
      chatId,
      `🎉 Промокод активирован!\n\n💎 +${promo.credits} кредитов\n💰 Ваш баланс: ${user.credits + promo.credits}`
    );
  } catch (error) {
    console.error('Ошибка /promo:', error);
    await bot.sendMessage(chatId, '❌ Ошибка активации промокода.');
  }
});
```

**Использование:**
```
Вы (админ): /createpromo WELCOME2024 50
Бот: ✅ Промокод создан!

Пользователь: /promo WELCOME2024
Бот: 🎉 +50 кредитов!
```

---

## 📊 Настройка статистики

**Файл:** `telegram-bot.js`, команда `/stats` или `admin_stats`

Добавьте свои метрики:

```javascript
// Топ генераторов
const topGenerators = db.db.prepare(`
  SELECT username, total_generations, total_spent_credits
  FROM users
  ORDER BY total_generations DESC
  LIMIT 5
`).all();

statsText += `🏆 *Топ генераторов:*\n`;
topGenerators.forEach((gen, idx) => {
  statsText += `${idx + 1}. @${gen.username}: ${gen.total_generations} генераций (${gen.total_spent_credits} кредитов)\n`;
});
```

---

## 🎨 Изменение стиля генерации изображений

**Файл:** `image-service.js`, метод `generateImage`

Добавьте префикс к промптам для определенного стиля:

```javascript
async generateImage(prompt) {
  // Добавляем стиль к промпту
  const styledPrompt = `${prompt}, high quality, detailed, masterpiece, 8k`;
  
  // Или для определенного стиля:
  // const styledPrompt = `${prompt}, anime style, vibrant colors`;
  // const styledPrompt = `${prompt}, realistic photo, professional photography`;
  
  // ... остальной код
}
```

---

## 📱 Добавление inline-режима

Позвольте пользователям генерировать из любого чата:

**Файл:** `telegram-bot.js`, добавьте:

```javascript
bot.on('inline_query', async (query) => {
  const queryText = query.query;
  
  if (!queryText) {
    return bot.answerInlineQuery(query.id, []);
  }
  
  const results = [
    {
      type: 'article',
      id: '1',
      title: `🎨 Сгенерировать: ${queryText}`,
      description: `Нажмите чтобы создать изображение (${PRICES.IMAGE_GEN} кредитов)`,
      input_message_content: {
        message_text: `🎨 Генерирую: "${queryText}"\n\n⏳ Подождите...`
      }
    }
  ];
  
  await bot.answerInlineQuery(query.id, results, {
    cache_time: 0
  });
});
```

Не забудьте включить inline-режим в @BotFather: `/setinline`

---

## 🔔 Добавление уведомлений

### Уведомление когда заканчиваются кредиты

**Файл:** `telegram-bot.js`, после списания кредитов:

```javascript
// После списания кредитов
const newBalance = user.credits - creditsUsed;

if (newBalance <= 5 && newBalance > 0) {
  await bot.sendMessage(
    chatId,
    `⚠️ У вас осталось всего ${newBalance} кредитов!\n\nПополните баланс: /buy`
  );
}

if (newBalance === 0) {
  await bot.sendMessage(
    chatId,
    `❌ Кредиты закончились!\n\n💰 Пополните баланс или пригласите друзей для бонусов:\n/buy | /referral`
  );
}
```

---

## 🎁 Ежедневный бонус

**Файл:** `telegram-bot.js`, добавьте команду:

```javascript
bot.onText(/\/daily/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const user = userQueries.getByTelegramId.get(chatId.toString());
    
    // Проверяем получал ли сегодня
    const lastDaily = transactionQueries.getHistory.all(user.id, 1)
      .find(t => t.description === 'Ежедневный бонус');
    
    const now = new Date();
    const lastDate = lastDaily ? new Date(lastDaily.created_at) : null;
    
    if (lastDate && now.toDateString() === lastDate.toDateString()) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const hoursLeft = Math.ceil((tomorrow - now) / (1000 * 60 * 60));
      
      return await bot.sendMessage(
        chatId,
        `⏰ Вы уже получили ежедневный бонус!\n\nПриходите через ${hoursLeft} ч.`
      );
    }
    
    // Начисляем бонус
    const dailyBonus = 3;
    userQueries.updateCredits.run(dailyBonus, user.id);
    transactionQueries.create.run(user.id, 'daily', dailyBonus, 0, 'Ежедневный бонус');
    
    await bot.sendMessage(
      chatId,
      `🎁 Ежедневный бонус получен!\n\n💎 +${dailyBonus} кредитов\n💰 Ваш баланс: ${user.credits + dailyBonus}\n\n⏰ Приходите завтра за новым бонусом!`
    );
  } catch (error) {
    console.error('Ошибка /daily:', error);
    await bot.sendMessage(chatId, '❌ Ошибка получения бонуса.');
  }
});
```

---

## 📝 Чек-лист изменений

После внесения изменений:

- [ ] Сохраните все файлы
- [ ] Проверьте нет ли опечаток
- [ ] Протестируйте локально: `node server.js`
- [ ] Закоммитьте изменения: `git add .` и `git commit -m "описание"`
- [ ] Запушьте на GitHub: `git push`
- [ ] Railway автоматически задеплоит изменения
- [ ] Проверьте логи на Railway
- [ ] Протестируйте бота в Telegram

---

## 💡 Полезные советы

1. **Делайте резервные копии** перед большими изменениями
2. **Тестируйте локально** перед деплоем
3. **Используйте git** для отката изменений если что-то сломалось
4. **Смотрите логи Railway** для отладки ошибок
5. **Добавляйте `console.log()`** для отслеживания работы кода

---

## 📞 Если что-то сломалось

1. Откройте Railway → Deployments → View Logs
2. Найдите ошибку в логах
3. Откройте нужный файл и исправьте
4. Сохраните и запушьте: `git add . && git commit -m "fix" && git push`
5. Railway автоматически передеплоит

---

**Готово! Теперь у вас есть полное руководство по кастомизации бота! 🚀**

