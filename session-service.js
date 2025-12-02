const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
    connectTimeout: 30000, // 30 секунд
    lazyConnect: true,
    retryStrategy: function (times) {
        return Math.min(times * 100, 3000);
    }
});

// Логируем хост
const redisHost = (redisUrl || '').split('@')[1] || 'localhost';
console.log(`🔍 [Session] Попытка подключения к Redis: ${redisHost}`);

redis.on('connect', () => {
    console.log('✅ [Session] Redis подключен');
});

redis.on('error', (err) => {
    console.error('❌ [Session] Ошибка Redis:', err.message);
});

const SESSION_TTL = 24 * 60 * 60; // 24 часа

const sessionService = {
    /**
     * Установить состояние пользователя
     * @param {number|string} chatId 
     * @param {object} stateData 
     */
    async setState(chatId, stateData) {
        try {
            await redis.set(`state:${chatId}`, JSON.stringify(stateData), 'EX', SESSION_TTL);
        } catch (error) {
            console.error(`Ошибка сохранения состояния для ${chatId}:`, error);
        }
    },

    /**
     * Получить состояние пользователя
     * @param {number|string} chatId 
     * @returns {Promise<object|null>}
     */
    async getState(chatId) {
        try {
            const data = await redis.get(`state:${chatId}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error(`Ошибка получения состояния для ${chatId}:`, error);
            return null;
        }
    },

    /**
     * Удалить состояние пользователя
     * @param {number|string} chatId 
     */
    async clearState(chatId) {
        try {
            await redis.del(`state:${chatId}`);
        } catch (error) {
            console.error(`Ошибка удаления состояния для ${chatId}:`, error);
        }
    },

    /**
     * Сохранить ID последнего сообщения (для удаления)
     * @param {number|string} chatId 
     * @param {number} messageId 
     */
    async addLastMessage(chatId, messageId) {
        try {
            await redis.rpush(`messages:${chatId}`, messageId);
            await redis.expire(`messages:${chatId}`, SESSION_TTL);
        } catch (error) {
            console.error(`Ошибка сохранения сообщения для ${chatId}:`, error);
        }
    },

    /**
     * Получить и удалить ID последних сообщений
     * @param {number|string} chatId 
     * @returns {Promise<number[]>}
     */
    async popLastMessages(chatId) {
        try {
            const messages = await redis.lrange(`messages:${chatId}`, 0, -1);
            if (messages.length > 0) {
                await redis.del(`messages:${chatId}`);
            }
            return messages.map(Number);
        } catch (error) {
            console.error(`Ошибка получения сообщений для ${chatId}:`, error);
            return [];
        }
    },

    /**
     * Проверка соединения
     * @returns {Promise<boolean>}
     */
    async ping() {
        try {
            const result = await redis.ping();
            return result === 'PONG';
        } catch (error) {
            return false;
        }
    }
};

module.exports = sessionService;
