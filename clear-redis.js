require('dotenv').config();
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

console.log(`Подключаюсь к Redis: ${redisUrl.replace(/:\/\/[^:]+:[^@]+@/, '://*****:*****@')}`);

const redis = new Redis(redisUrl, {
    connectTimeout: 30000,
    lazyConnect: true
});

redis.on('connect', () => {
    console.log('✅ Подключен к Redis');
});

redis.on('error', (err) => {
    console.error('❌ Ошибка подключения:', err.message);
    process.exit(1);
});

async function clearRedis() {
    try {
        await redis.connect();

        console.log('🗑️ Очищаю очередь BullMQ...');
        const queueKeys = await redis.keys('bull:image-generation:*');
        if (queueKeys.length > 0) {
            await redis.del(...queueKeys);
            console.log(`✅ Удалено ${queueKeys.length} ключей очереди`);
        } else {
            console.log('ℹ️ Ключей очереди не найдено');
        }

        console.log('🗑️ Очищаю сессии...');
        const sessionKeys = await redis.keys('state:*');
        const messageKeys = await redis.keys('messages:*');
        const allKeys = [...sessionKeys, ...messageKeys];

        if (allKeys.length > 0) {
            await redis.del(...allKeys);
            console.log(`✅ Удалено ${allKeys.length} ключей сессий`);
        } else {
            console.log('ℹ️ Ключей сессий не найдено');
        }

        console.log('✅ Redis очищен!');
        await redis.quit();
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

clearRedis();
