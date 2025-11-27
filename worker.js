require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const TelegramBot = require('node-telegram-bot-api');
const ImageService = require('./image-service');
const { userQueries, transactionQueries, generationQueries } = require('./database-postgres');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null
});

connection.on('connect', () => console.log('✅ [Worker] Redis connected'));
connection.on('ready', () => console.log('✅ [Worker] Redis ready'));
connection.on('error', (err) => console.error('❌ [Worker] Redis error:', err));
console.log(`🔍 [Worker] Redis URL: ${process.env.REDIS_URL || 'default localhost'}`);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const imageService = new ImageService(process.env.GEMINI_API_KEY);

console.log('🚀 Worker started. Waiting for jobs...');

const worker = new Worker('image-generation', async job => {
    const { chatId, prompt, userId, messageId, fileId, statusMessageId } = job.data;
    console.log(`Processing job ${job.id} (${job.name}) for user ${userId}`);

    try {
        if (job.name === 'generate-image') {
            // ==================== ГЕНЕРАЦИЯ ====================
            console.log(`🎨 Generating image for prompt: ${prompt}`);
            const result = await imageService.generateImage(prompt);

            // Списываем кредиты (фиксированная цена)
            const creditsCost = 2; // PRICES.IMAGE_GEN
            await userQueries.updateCredits(-creditsCost, userId);

            // Сохраняем в БД
            const base64Image = result.imageBuffer.toString('base64');
            await generationQueries.create(userId, prompt, '[Изображение]', creditsCost, 'image', base64Image);
            await transactionQueries.create(userId, 'generation', -creditsCost, 0, 'Генерация изображения');

            // Отправляем пользователю
            await bot.sendPhoto(chatId, result.imageBuffer, {
                caption: `✨ Готово! (потрачено ${creditsCost} кр.)`,
                reply_to_message_id: messageId
            }, {
                filename: 'image.png',
                contentType: 'image/png'
            });

            // Удаляем сообщение "Рисую..."
            if (statusMessageId) {
                try {
                    await bot.deleteMessage(chatId, statusMessageId);
                } catch (e) {
                    console.error('Failed to delete status message:', e.message);
                }
            }

        } else if (job.name === 'edit-image') {
            // ==================== РЕДАКТИРОВАНИЕ ====================
            console.log(`✏️ Editing image with prompt: ${prompt}`);

            // 1. Получаем ссылку на файл
            const fileLink = await bot.getFileLink(fileId);

            // 2. Скачиваем изображение
            const https = require('https');
            const imageBuffer = await new Promise((resolve, reject) => {
                https.get(fileLink, (response) => {
                    const chunks = [];
                    response.on('data', chunk => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks)));
                }).on('error', reject);
            });
            console.log(`📥 Downloaded image (${imageBuffer.length} bytes)`);

            // 3. Редактируем
            const result = await imageService.editImage(imageBuffer, prompt);

            // 4. Списываем кредиты
            const creditsCost = 2; // PRICES.IMAGE_EDIT
            await userQueries.updateCredits(-creditsCost, userId);

            // 5. Сохраняем в БД
            const base64Image = result.imageBuffer.toString('base64');
            await generationQueries.create(userId, `[Редактирование] ${prompt}`, '[Изображение]', creditsCost, 'image_edit', base64Image);
            await transactionQueries.create(userId, 'generation', -creditsCost, 0, 'Редактирование изображения');

            // 6. Отправляем результат
            await bot.sendPhoto(chatId, result.imageBuffer, {
                caption: `✏️ Готово! (потрачено ${creditsCost} кр.)`,
                reply_to_message_id: messageId
            }, {
                filename: 'edited_image.png',
                contentType: 'image/png'
            });

            // Удаляем сообщение "Рисую..."
            if (statusMessageId) {
                try {
                    await bot.deleteMessage(chatId, statusMessageId);
                } catch (e) {
                    console.error('Failed to delete status message:', e.message);
                }
            }
        }

        console.log(`Job ${job.id} completed successfully`);
    } catch (error) {
        console.error(`Job ${job.id} failed:`, error);

        // Если это ошибка 429 (Too Many Requests), не пытаемся отправить сообщение
        // чтобы не усугублять ситуацию
        if (error?.response?.body?.error_code === 429 || error?.response?.statusCode === 429) {
            console.warn('⚠️ Telegram Rate Limit hit! Skipping error notification to user.');
            throw error;
        }

        // Уведомляем об ошибке (если это не рейт-лимит)
        try {
            await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`, {
                reply_to_message_id: messageId
            });
        } catch (sendError) {
            console.error('Failed to send error notification:', sendError.message);
        }

        // Удаляем сообщение "Рисую..." даже при ошибке
        if (statusMessageId) {
            try {
                await bot.deleteMessage(chatId, statusMessageId);
            } catch (e) {
                console.error('Failed to delete status message on error:', e.message);
            }
        }

        throw error;
    }
}, {
    connection,
    limiter: {
        max: 1,
        duration: 1000 // Ограничение: 1 задача в секунду
    }
});

worker.on('completed', job => {
    console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
    console.log(`${job.id} has failed with ${err.message}`);
});
