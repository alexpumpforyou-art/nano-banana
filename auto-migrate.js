#!/usr/bin/env node
require('dotenv').config();

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

console.log('🔍 Checking migration status...');

// Only migrate if DATABASE_URL is set (Railway environment)
if (!process.env.DATABASE_URL) {
    console.log('⚠️  DATABASE_URL not found - skipping auto-migration (local development)');
    process.exit(0);
}

console.log('✅ DATABASE_URL found - proceeding with migration');

// Create knex instance with SSL for Railway
const knex = require('knex')({
    client: 'pg',
    connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    },
    pool: { min: 0, max: 1, acquireTimeoutMillis: 30000 }
});

const dbPath = path.join(__dirname, 'nano_banana.db');

// Check if SQLite database exists
if (!fs.existsSync(dbPath)) {
    console.log('ℹ️  SQLite database not found - skipping data migration');
    knex.destroy();
    process.exit(0);
}

const sqlite = new Database(dbPath, { readonly: true });

async function autoMigrate() {
    console.log('🚀 Starting auto-migration from SQLite to PostgreSQL...');

    try {
        // Check if already migrated (check if users exist)
        const existingUsers = await knex('users').count('* as count').first();
        if (existingUsers && parseInt(existingUsers.count) > 0) {
            console.log(`ℹ️  Database already has ${existingUsers.count} users - skipping migration`);
            return;
        }

        // 1. Users
        console.log('👤 Migrating users...');
        const users = sqlite.prepare('SELECT * FROM users').all();
        for (const user of users) {
            const existing = await knex('users').where('telegram_id', user.telegram_id).first();
            if (!existing) {
                await knex('users').insert({
                    telegram_id: user.telegram_id,
                    username: user.username,
                    credits: user.credits,
                    generations_count: user.total_generations,
                    total_spent_credits: user.total_spent_credits || 0,
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

        console.log('🎉 Auto-migration completed successfully!');
    } catch (error) {
        console.error('❌ Auto-migration failed:', error);
        throw error;
    }
}

// Run migration with timeout to prevent hanging
const MIGRATION_TIMEOUT = 30000; // 30 seconds

Promise.race([
    autoMigrate(),
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Migration timeout')), MIGRATION_TIMEOUT)
    )
])
    .then(() => {
        console.log('✅ Migration process completed');
    })
    .catch(err => {
        console.error('⚠️  Migration failed or timed out:', err.message);
        console.log('Server will start anyway...');
    })
    .finally(async () => {
        try {
            await knex.destroy();
            sqlite.close();
        } catch (e) {
            // Ignore cleanup errors
        }
        process.exit(0);
    });
