const Database = require('better-sqlite3');
const path = require('path');
const knexConfig = require('./knexfile');
const knex = require('knex')(knexConfig[process.env.NODE_ENV || 'development']);

const dbPath = path.join(__dirname, 'nano_banana.db');
const sqlite = new Database(dbPath);

async function migrateData() {
    console.log('🚀 Starting migration from SQLite to PostgreSQL...');

    try {
        // 1. Users
        console.log('👤 Migrating users...');
        const users = sqlite.prepare('SELECT * FROM users').all();
        for (const user of users) {
            // Check if exists
            const existing = await knex('users').where('telegram_id', user.telegram_id).first();
            if (!existing) {
                await knex('users').insert({
                    telegram_id: user.telegram_id,
                    username: user.username,
                    credits: user.credits,
                    generations_count: user.total_generations,
                    is_blocked: user.is_blocked === 1,
                    created_at: new Date(user.created_at),
                    last_activity: new Date(user.last_used)
                });
            }
        }
        console.log(`✅ Migrated ${users.length} users.`);

        // 2. Transactions
        console.log('💰 Migrating transactions...');
        const transactions = sqlite.prepare('SELECT * FROM transactions').all();
        for (const tx of transactions) {
            // Find PG user id
            const sqliteUser = users.find(u => u.id === tx.user_id);
            if (sqliteUser) {
                const pgUser = await knex('users').where('telegram_id', sqliteUser.telegram_id).first();
                if (pgUser) {
                    await knex('transactions').insert({
                        user_id: pgUser.id,
                        type: tx.type,
                        amount: tx.amount,
                        price: tx.stars_paid || 0,
                        description: tx.description,
                        created_at: new Date(tx.created_at)
                    });
                }
            }
        }
        console.log(`✅ Migrated ${transactions.length} transactions.`);

        // 3. Generations
        console.log('🎨 Migrating generations...');
        const generations = sqlite.prepare('SELECT * FROM generations').all();
        for (const gen of generations) {
            const sqliteUser = users.find(u => u.id === gen.user_id);
            if (sqliteUser) {
                const pgUser = await knex('users').where('telegram_id', sqliteUser.telegram_id).first();
                if (pgUser) {
                    await knex('generations').insert({
                        user_id: pgUser.id,
                        prompt: gen.prompt,
                        result: gen.response,
                        cost: gen.credits_used,
                        type: gen.type,
                        image_data: gen.image_data,
                        created_at: new Date(gen.created_at)
                    });
                }
            }
        }
        console.log(`✅ Migrated ${generations.length} generations.`);

        console.log('🎉 Migration completed successfully!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await knex.destroy();
        sqlite.close();
    }
}

migrateData();
