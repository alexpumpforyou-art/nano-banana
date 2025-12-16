#!/usr/bin/env node
require('dotenv').config();

/**
 * Safe migration script that retries on failure and allows server to start anyway
 */

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMigrations() {
    if (!process.env.DATABASE_URL) {
        console.log('⚠️  DATABASE_URL not set - skipping migrations');
        return true;
    }

    const knex = require('knex')({
        client: 'pg',
        connection: {
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        },
        pool: {
            min: 0,
            max: 2,
            acquireTimeoutMillis: 15000,
            createTimeoutMillis: 15000
        }
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`🔄 Migration attempt ${attempt}/${MAX_RETRIES}...`);

            // Test connection first
            await knex.raw('SELECT 1');
            console.log('✅ Database connected');

            // Run migrations
            const [batchNo, log] = await knex.migrate.latest();

            if (log.length === 0) {
                console.log('✅ Already up to date');
            } else {
                console.log(`✅ Ran ${log.length} migrations (batch ${batchNo})`);
                console.log(log.join('\n'));
            }

            await knex.destroy();
            return true;

        } catch (error) {
            console.error(`❌ Attempt ${attempt} failed:`, error.message);

            try {
                await knex.destroy();
            } catch (e) {
                // Ignore cleanup errors
            }

            if (attempt < MAX_RETRIES) {
                console.log(`⏳ Waiting ${RETRY_DELAY / 1000}s before retry...`);
                await sleep(RETRY_DELAY);
            }
        }
    }

    console.log('⚠️  All migration attempts failed - server will start without migrations');
    return false;
}

runMigrations()
    .then(success => {
        if (success) {
            console.log('🚀 Migrations complete, starting server...');
        } else {
            console.log('⚠️  Starting server without migrations...');
        }
        process.exit(0); // Always exit 0 to allow server to start
    })
    .catch(error => {
        console.error('❌ Unexpected error:', error.message);
        process.exit(0); // Still exit 0 to allow server to start
    });
