require('dotenv').config();
const { knex } = require('./database-postgres');

console.log('DEBUG: NODE_ENV =', process.env.NODE_ENV);
console.log('DEBUG: DATABASE_URL is', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

async function recalculateStats() {
    console.log('🔄 Начинаю пересчет статистики пользователей...');

    try {
        // 1. Сбрасываем текущую статистику для всех пользователей
        console.log('🧹 Сбрасываем счетчики...');
        await knex('users').update({
            generations_count: 0,
            total_spent_credits: 0
        });

        // 2. Получаем всех пользователей
        const users = await knex('users').select('id', 'username', 'telegram_id');
        console.log(`👥 Найдено пользователей: ${users.length}`);

        let updatedCount = 0;

        for (const user of users) {
            // 3. Считаем реальные генерации для каждого пользователя
            const stats = await knex('generations')
                .select(
                    knex.raw('COUNT(*) as count'),
                    knex.raw('SUM(cost) as total_cost')
                )
                .where('user_id', user.id)
                .first();

            const count = parseInt(stats.count) || 0;
            const totalCost = parseInt(stats.total_cost) || 0;

            if (count > 0) {
                // 4. Обновляем пользователя
                await knex('users')
                    .where('id', user.id)
                    .update({
                        generations_count: count,
                        total_spent_credits: totalCost
                    });

                updatedCount++;
                if (updatedCount % 10 === 0) {
                    process.stdout.write('.');
                }
            }
        }

        console.log(`\n✅ Пересчет завершен!`);
        console.log(`📊 Обновлено пользователей: ${updatedCount}`);

    } catch (error) {
        console.error('❌ Ошибка при пересчете:', error);
    } finally {
        await knex.destroy();
    }
}

recalculateStats();
