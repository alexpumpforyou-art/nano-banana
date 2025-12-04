require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const TelegramBot = require('node-telegram-bot-api');
const ImageService = require('./image-service');
const { userQueries, transactionQueries, generationQueries } = require('./database-postgres');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    connectTimeout: 30000, // 30 секунд
    family: 6, // Force IPv6 for Railway internal network
    retryStrategy: function (times) {
        return Math.min(times * 100, 3000);
    }
});

// Логируем хост (без пароля) для проверки
const redisHost = (process.env.REDIS_URL || '').split('@')[1] || 'localhost';
console.log(`🔍 [Worker] Попытка подключения к Redis: ${redisHost}`);

connection.on('connect', async () => {
    console.log('✅ [Worker] Redis connected');
    try {
        console.log('🧹 Очистка очереди...');
        await connection.flushall();
        console.log('✨ Redis полностью очищен!');
    } catch (e) {
        console.error('Ошибка очистки:', e);
    }
});

connection.on('error', (err) => console.error('❌ [Worker] Redis error:', err.message));

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
            console.log('💳 Updating credits...');
            const creditsCost = 2; // PRICES.IMAGE_GEN
            await userQueries.updateCredits(-creditsCost, userId);

            // Сохраняем в БД
            console.log('💾 Saving to DB...');
            const base64Image = result.imageBuffer.toString('base64');
            await generationQueries.create(userId, prompt, '[Изображение]', creditsCost, 'image', base64Image);
            await transactionQueries.create(userId, 'generation', -creditsCost, 0, 'Генерация изображения');
            await userQueries.incrementGenerations(creditsCost, userId);

            // Отправляем пользователю
            console.log('📤 Sending photo to Telegram...');
            await bot.sendPhoto(chatId, result.imageBuffer, {
                caption: `✨ Готово! (потрачено ${creditsCost} кр.)`,
                reply_to_message_id: messageId
            }, {
                filename: 'image.png',
                contentType: 'image/png'
            });
            console.log('✅ Photo sent');

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

            // 1. Получаем ID файлов (поддержка и массива, и одиночного ID)
            const ids = job.data.fileIds || (job.data.fileId ? [job.data.fileId] : []);

            if (ids.length === 0) {
                throw new Error('No file IDs provided');
            }

            console.log(`📥 Downloading ${ids.length} images...`);

            // 2. Скачиваем все изображения
            const imageBuffers = [];
            const https = require('https');

            for (const id of ids) {
                const fileLink = await bot.getFileLink(id);

                const buffer = await new Promise((resolve, reject) => {
                    https.get(fileLink, (response) => {
                        const chunks = [];
                        response.on('data', chunk => chunks.push(chunk));
                        response.on('end', () => resolve(Buffer.concat(chunks)));
                    }).on('error', reject);
                });

                imageBuffers.push(buffer);
            }

            console.log(`✅ Downloaded ${imageBuffers.length} images`);

            // 3. Редактируем (передаем массив буферов)
            const result = await imageService.editImage(imageBuffers, prompt);

            // 4. Списываем кредиты
            console.log('💳 Updating credits...');
            const creditsCost = 2; // PRICES.IMAGE_EDIT
            await userQueries.updateCredits(-creditsCost, userId);

            // 5. Сохраняем в БД
            console.log('💾 Saving to DB...');
            const base64Image = result.imageBuffer.toString('base64');
            await generationQueries.create(userId, `[Редактирование] ${prompt}`, '[Изображение]', creditsCost, 'image_edit', base64Image);
            await transactionQueries.create(userId, 'generation', -creditsCost, 0, 'Редактирование изображения');
            await userQueries.incrementGenerations(creditsCost, userId);

            // 6. Отправляем результат
            console.log('📤 Sending photo to Telegram...');
            await bot.sendPhoto(chatId, result.imageBuffer, {
                caption: `✏️ Готово! (потрачено ${creditsCost} кр.)`,
                reply_to_message_id: messageId
            }, {
                filename: 'edited_image.png',
                contentType: 'image/png'
            });
            console.log('✅ Photo sent');

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

        // Удаляем сообщение "Рисую..." даже при ошибке
        if (statusMessageId) {
            try {
                await bot.deleteMessage(chatId, statusMessageId);
            } catch (e) {
                console.error('Failed to delete status message on error:', e.message);
            }
        }

        // Определяем понятное сообщение для пользователя
        let userMessage = '❌ Не удалось обработать запрос.';

        if (error.message.includes('Модель вернула пустой результат')) {
            userMessage = '❌ Gemini 3 Pro Image не смог сгенерировать изображение по этому промпту.\n\n💡 Попробуйте упростить описание или изменить формулировку.';
        } else if (error.message.includes('API key')) {
            userMessage = '❌ Ошибка API ключа. Обратитесь к администратору.';
        } else if (error.message.includes('quota') || error.message.includes('limit')) {
            userMessage = '❌ Превышен лимит запросов API.\n\n⏳ Попробуйте через несколько минут.';
        } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            userMessage = '❌ Превышено время ожидания ответа от API.\n\n⏳ Попробуйте еще раз.';
        } else if (error.message.includes('Недостаточно кредитов')) {
            userMessage = '❌ Недостаточно кредитов для выполнения операции.\n\n💰 Используйте /buy для пополнения.';
        } else {
            // Для других ошибок показываем техническую информацию
            userMessage = `❌ Ошибка при обработке запроса:\n${error.message}`;
        }

        // Уведомляем об ошибке (если это не рейт-лимит)
        try {
            await bot.sendMessage(chatId, userMessage, {
                reply_to_message_id: messageId
            });
        } catch (sendError) {
            console.error('Failed to send error notification:', sendError.message);
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
