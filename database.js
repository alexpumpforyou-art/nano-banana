const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Определяем путь к базе данных
// В продакшене (Railway) используем Volume: /app/data
// Локально используем текущую директорию
const dbDir = process.env.NODE_ENV === 'production' ? '/app/data' : __dirname;

// Создаем директорию если её нет
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'nano_banana.db');
console.log(`📁 Путь к базе данных: ${dbPath}`);

// Создаем или открываем базу данных
const db = new Database(dbPath);

// Инициализация таблиц
function initDatabase() {
  // Таблица пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      web_id TEXT UNIQUE,
      username TEXT,
      credits INTEGER DEFAULT 0,
      total_generations INTEGER DEFAULT 0,
      total_spent_credits INTEGER DEFAULT 0,
      referral_code TEXT UNIQUE,
      referred_by INTEGER,
      referral_bonus_earned INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referred_by) REFERENCES users(id)
    )
  `);
  
  // Миграция: добавляем новые колонки если их нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE users ADD COLUMN total_generations INTEGER DEFAULT 0`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE users ADD COLUMN total_spent_credits INTEGER DEFAULT 0`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE users ADD COLUMN referral_bonus_earned INTEGER DEFAULT 0`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0`);
  } catch (e) { /* колонка уже существует */ }
  
  // Мигрируем старые tokens в credits (деноминация: 50 токенов = 1 кредит)
  try {
    const usersWithTokens = db.prepare(`SELECT id, tokens FROM users WHERE tokens > 0 AND (credits IS NULL OR credits = 0)`).all();
    if (usersWithTokens.length > 0) {
      console.log(`🔄 Миграция: конвертируем токены в кредиты для ${usersWithTokens.length} пользователей...`);
      const updateStmt = db.prepare(`UPDATE users SET credits = ? WHERE id = ?`);
      for (const user of usersWithTokens) {
        const newCredits = Math.ceil(user.tokens / 50); // 50 токенов = 1 кредит
        updateStmt.run(newCredits, user.id);
      }
      console.log(`✅ Миграция завершена`);
    }
  } catch (e) {
    console.log('ℹ️ Миграция токенов пропущена');
  }

  // Таблица транзакций
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      amount INTEGER,
      stars_paid INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Таблица генераций
  db.exec(`
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      prompt TEXT,
      response TEXT,
      credits_used INTEGER,
      type TEXT DEFAULT 'text',
      image_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  // Миграция: добавляем колонку image_data если её нет
  try {
    db.exec(`ALTER TABLE generations ADD COLUMN image_data TEXT`);
  } catch (e) { /* колонка уже существует */ }
  
  // Таблица рефералов (для детальной статистики)
  db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER,
      referred_id INTEGER,
      bonus_earned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_id) REFERENCES users(id)
    )
  `);

  // Таблица контента для меню и приветствий
  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT,
      text TEXT,
      image_data TEXT,
      order_index INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Создаем индексы для быстрого поиска
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_content_type ON content(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_content_active ON content(is_active)`);
  } catch (e) { /* индексы уже существуют */ }
  
  // Инициализируем дефолтный контент если его нет
  try {
    const existingWelcome = db.prepare('SELECT COUNT(*) as count FROM content WHERE type = ?').get('welcome');
    if (existingWelcome.count === 0) {
      db.prepare(`
        INSERT INTO content (type, title, text, order_index, is_active)
        VALUES ('welcome', 'Приветствие', '🍌 Добро пожаловать в Nano Banana!\n\n💎 Ваш баланс: *{credits} кредитов*\n📊 Генераций: {generations}\n\n📝 Отправьте мне текст для генерации или выберите действие:', 0, 1)
      `).run();
    }
    
    const existingMenu = db.prepare('SELECT COUNT(*) as count FROM content WHERE type = ?').get('menu');
    if (existingMenu.count === 0) {
      db.prepare(`
        INSERT INTO content (type, title, text, order_index, is_active)
        VALUES ('menu', 'Меню', '📋 Главное меню', 0, 1)
      `).run();
    }
  } catch (e) {
    console.log('ℹ️ Дефолтный контент уже существует или ошибка создания');
  }

  console.log('✅ База данных инициализирована');
}

// Инициализируем БД сразу при загрузке модуля
initDatabase();

// Генератор реферальных кодов
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Функции для работы с пользователями
const userQueries = {
  // Создать или получить пользователя по Telegram ID
  getOrCreateTelegramUser: db.prepare(`
    INSERT INTO users (telegram_id, username, credits, referral_code)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      last_used = CURRENT_TIMESTAMP
    RETURNING *
  `),

  // Создать или получить пользователя по Web ID
  getOrCreateWebUser: db.prepare(`
    INSERT INTO users (web_id, credits, referral_code)
    VALUES (?, ?, ?)
    ON CONFLICT(web_id) DO UPDATE SET
      last_used = CURRENT_TIMESTAMP
    RETURNING *
  `),

  // Получить пользователя по Telegram ID
  getByTelegramId: db.prepare('SELECT * FROM users WHERE telegram_id = ?'),

  // Получить пользователя по Web ID
  getByWebId: db.prepare('SELECT * FROM users WHERE web_id = ?'),
  
  // Получить пользователя по реферальному коду
  getByReferralCode: db.prepare('SELECT * FROM users WHERE referral_code = ?'),

  // Обновить баланс кредитов
  updateCredits: db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?'),
  
  // Увеличить счетчик генераций
  incrementGenerations: db.prepare('UPDATE users SET total_generations = total_generations + 1, total_spent_credits = total_spent_credits + ? WHERE id = ?'),
  
  // Установить реферера
  setReferrer: db.prepare('UPDATE users SET referred_by = ? WHERE id = ?'),
  
  // Начислить реферальный бонус
  addReferralBonus: db.prepare('UPDATE users SET referral_bonus_earned = referral_bonus_earned + ?, credits = credits + ? WHERE id = ?'),
  
  // Заблокировать/разблокировать пользователя
  setBlocked: db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?'),

  // Проверить баланс
  getBalance: db.prepare('SELECT credits FROM users WHERE id = ?'),
  
  // Получить статистику рефералов
  getReferrals: db.prepare(`
    SELECT u.id, u.username, u.telegram_id, u.created_at, u.total_generations
    FROM users u
    WHERE u.referred_by = ?
    ORDER BY u.created_at DESC
  `),
  
  // Подсчитать количество рефералов
  countReferrals: db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?'),
  
  // АДМИН-ПАНЕЛЬ: Получить всех пользователей
  getAllUsers: db.prepare(`
    SELECT 
      id, telegram_id, web_id, username, credits, 
      total_generations, total_spent_credits, 
      referral_code, referred_by, referral_bonus_earned,
      is_blocked, created_at, last_used
    FROM users
    ORDER BY created_at DESC
  `),
  
  // АДМИН-ПАНЕЛЬ: Получить пользователя по ID с детальной статистикой
  getAdminUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  
  // АДМИН-ПАНЕЛЬ: Подсчитать общую статистику
  getTotalStats: db.prepare(`
    SELECT 
      COUNT(*) as total_users,
      COUNT(CASE WHEN telegram_id IS NOT NULL THEN 1 END) as telegram_users,
      COUNT(CASE WHEN web_id IS NOT NULL THEN 1 END) as web_users,
      COUNT(CASE WHEN is_blocked = 1 THEN 1 END) as blocked_users,
      SUM(total_generations) as total_generations,
      SUM(total_spent_credits) as total_spent_credits,
      SUM(credits) as total_credits_balance,
      SUM(referral_bonus_earned) as total_referral_bonuses
    FROM users
  `),
};

// Функции для работы с транзакциями
const transactionQueries = {
  create: db.prepare(`
    INSERT INTO transactions (user_id, type, amount, stars_paid, description)
    VALUES (?, ?, ?, ?, ?)
  `),

  getHistory: db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  
  // АДМИН-ПАНЕЛЬ: Получить все транзакции пользователя
  getAllByUserId: db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `),
  
  // АДМИН-ПАНЕЛЬ: Подсчитать общую статистику транзакций
  getTotalStats: db.prepare(`
    SELECT 
      COUNT(*) as total_transactions,
      SUM(CASE WHEN type = 'payment' THEN stars_paid ELSE 0 END) as total_stars_received,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_credits_added,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_credits_spent
    FROM transactions
  `),
};

// Функции для работы с генерациями
const generationQueries = {
  create: db.prepare(`
    INSERT INTO generations (user_id, prompt, response, credits_used, type, image_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  getHistory: db.prepare(`
    SELECT id, prompt, SUBSTR(response, 1, 100) as response_preview, credits_used, type, created_at
    FROM generations
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  
  // АДМИН-ПАНЕЛЬ: Получить все генерации пользователя
  getAllByUserId: db.prepare(`
    SELECT id, prompt, SUBSTR(response, 1, 200) as response_preview, credits_used, type, image_data, created_at
    FROM generations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `),
  
  // АДМИН-ПАНЕЛЬ: Подсчитать генерации по типам
  countByType: db.prepare(`
    SELECT type, COUNT(*) as count, SUM(credits_used) as total_credits
    FROM generations
    GROUP BY type
  `),
};

// Функции для работы с рефералами
const referralQueries = {
  create: db.prepare(`
    INSERT INTO referrals (referrer_id, referred_id, bonus_earned)
    VALUES (?, ?, ?)
  `),
  
  getByReferrer: db.prepare(`
    SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC
  `),
  
  getTotalBonus: db.prepare(`
    SELECT SUM(bonus_earned) as total FROM referrals WHERE referrer_id = ?
  `),
};

// Функции для работы с контентом
const contentQueries = {
  // Получить контент по типу
  getByType: db.prepare(`
    SELECT * FROM content 
    WHERE type = ? AND is_active = 1 
    ORDER BY order_index ASC, created_at ASC 
    LIMIT 1
  `),
  
  // Получить все контенты по типу (для админ-панели)
  getAllByType: db.prepare(`
    SELECT * FROM content 
    WHERE type = ? 
    ORDER BY order_index ASC, created_at DESC
  `),
  
  // Получить все контенты
  getAll: db.prepare(`
    SELECT * FROM content 
    ORDER BY type ASC, order_index ASC, created_at DESC
  `),
  
  // Получить контент по ID
  getById: db.prepare('SELECT * FROM content WHERE id = ?'),
  
  // Создать контент
  create: db.prepare(`
    INSERT INTO content (type, title, text, image_data, order_index, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  
  // Обновить контент
  update: db.prepare(`
    UPDATE content 
    SET title = ?, text = ?, image_data = ?, order_index = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  
  // Удалить контент
  delete: db.prepare('DELETE FROM content WHERE id = ?'),
};

module.exports = {
  db,
  initDatabase,
  generateReferralCode,
  userQueries,
  transactionQueries,
  generationQueries,
  referralQueries,
  contentQueries,
};

