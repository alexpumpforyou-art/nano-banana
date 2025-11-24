require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const TelegramBot = require('node-telegram-bot-api');
const ImageService = require('./image-service');
const { userQueries, transactionQueries, generationQueries } = require('./database-postgres');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const imageService = new ImageService(process.env.GEMINI_API_KEY);

console.log('🚀 Worker started. Waiting for jobs...');

const worker = new Worker('image-generation', async job => {
    const { chatId, prompt, userId, messageId } = job.data;
    console.log(`Processing job ${job.id} for user ${userId}: ${prompt}`);

    try {
        // 1. Генерируем изображение
        const result = await imageService.generateImage(prompt);

        // 2. Списываем кредиты (фиксированная цена)
        const creditsCost = 2; // PRICES.IMAGE_GEN
        await userQueries.updateCredits(-creditsCost, userId);

        // 3. Сохраняем в БД
        const base64Image = result.imageBuffer.toString('base64');
        await generationQueries.create(userId, prompt, '[Изображение]', creditsCost, 'image', base64Image);
        await transactionQueries.create(userId, 'generation', -creditsCost, 0, 'Генерация изображения');

        // 4. Отправляем пользователю
        await bot.sendPhoto(chatId, result.imageBuffer, {
            caption: `✨ Готово! (потрачено ${result.tokensUsed} кр.)`,
            reply_to_message_id: messageId
        }, {
            filename: 'image.png',
            contentType: 'image/png'
        });

        console.log(`Job ${job.id} completed successfully`);
    } catch (error) {
        console.error(`Job ${job.id} failed:`, error);

        // Уведомляем об ошибке
        await bot.sendMessage(chatId, `❌ Не удалось сгенерировать изображение: ${error.message}`, {
            reply_to_message_id: messageId
        });

        throw error;
    }
}, { connection });

worker.on('completed', job => {
    console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
    console.log(`${job.id} has failed with ${err.message}`);
});
