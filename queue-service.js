const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    connectTimeout: 30000,
    lazyConnect: true,
    family: 0, // Auto-detect (prefer IPv6, fallback to IPv4)
    retryStrategy: function (times) {
        // Exponential backoff with jitter to prevent thundering herd
        const delay = Math.min(times * 200, 10000);
        const jitter = Math.random() * 500;
        console.log(`🔄 [Queue] Redis reconnecting in ${Math.round(delay + jitter)}ms (attempt ${times})`);
        return delay + jitter;
    }
});

// Логируем хост
const redisHost = (process.env.REDIS_URL || '').split('@')[1] || 'localhost';
console.log(`🔍 [Queue] Попытка подключения к Redis: ${redisHost}`);

connection.on('connect', () => console.log('✅ [Queue] Redis connected'));
connection.on('error', (err) => console.error('❌ [Queue] Redis error:', err.message));

const generationQueue = new Queue('image-generation', { connection });

module.exports = {
    generationQueue
};
