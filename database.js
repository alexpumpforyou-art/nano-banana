const Database = require('better-sqlite3');
const path = require('path');

// Создаем или открываем базу данных
const db = new Database(path.join(__dirname, 'nano_banana.db'));

// Инициализация таблиц
function initDatabase() {
  // Таблица пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      web_id TEXT UNIQUE,
      username TEXT,
      tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      tokens_used INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  console.log('✅ База данных инициализирована');
}

// Инициализируем БД сразу при загрузке модуля
initDatabase();

// Функции для работы с пользователями
const userQueries = {
  // Создать или получить пользователя по Telegram ID
  getOrCreateTelegramUser: db.prepare(`
    INSERT INTO users (telegram_id, username, tokens)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      last_used = CURRENT_TIMESTAMP
    RETURNING *
  `),

  // Создать или получить пользователя по Web ID
  getOrCreateWebUser: db.prepare(`
    INSERT INTO users (web_id, tokens)
    VALUES (?, ?)
    ON CONFLICT(web_id) DO UPDATE SET
      last_used = CURRENT_TIMESTAMP
    RETURNING *
  `),

  // Получить пользователя по Telegram ID
  getByTelegramId: db.prepare('SELECT * FROM users WHERE telegram_id = ?'),

  // Получить пользователя по Web ID
  getByWebId: db.prepare('SELECT * FROM users WHERE web_id = ?'),

  // Обновить баланс токенов
  updateTokens: db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?'),

  // Проверить баланс
  getBalance: db.prepare('SELECT tokens FROM users WHERE id = ?'),
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
};

// Функции для работы с генерациями
const generationQueries = {
  create: db.prepare(`
    INSERT INTO generations (user_id, prompt, response, tokens_used)
    VALUES (?, ?, ?, ?)
  `),

  getHistory: db.prepare(`
    SELECT id, prompt, SUBSTR(response, 1, 100) as response_preview, tokens_used, created_at
    FROM generations
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
};

module.exports = {
  db,
  initDatabase,
  userQueries,
  transactionQueries,
  generationQueries,
};

