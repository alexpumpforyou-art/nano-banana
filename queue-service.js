const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    connectTimeout: 30000, // 30 секунд
    retryStrategy: function (times) {
        return Math.min(times * 100, 3000);
    }
});

// Логируем хост
const redisHost = (process.env.REDIS_URL || '').split('@')[1] || 'localhost';
console.log(`🔍 [Queue] Попытка подключения к Redis: ${redisHost}`);

connection.on('connect', () => console.log('✅ [Queue] Redis connected'));
connection.on('error', (err) => console.error('❌ [Queue] Redis error:', err.message));

module.exports = {
    generationQueue
};
