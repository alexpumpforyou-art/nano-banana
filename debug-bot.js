require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN не найден в .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

async function checkWebhook() {
    try {
        const info = await bot.getWebHookInfo();
        console.log('🔍 Информация о вебхуке:');
        console.log(JSON.stringify(info, null, 2));

        if (info.url) {
            console.warn('⚠️  ВНИМАНИЕ: Установлен вебхук!', info.url);
            console.warn('   Это может мешать работе polling (long polling).');
        } else {
            console.log('✅ Вебхук не установлен (это хорошо для polling).');
        }

        const me = await bot.getMe();
        console.log('\n🤖 Информация о боте:');
        console.log(`   ID: ${me.id}`);
        console.log(`   Username: @${me.username}`);
        console.log(`   Name: ${me.first_name}`);

    } catch (error) {
        console.error('❌ Ошибка при проверке:', error.message);
    }
}

checkWebhook();
