require('dotenv').config();

module.exports = {
    development: {
        client: 'pg',
        connection: process.env.DATABASE_URL || {
            host: '127.0.0.1',
            user: 'postgres',
            password: 'password',
            database: 'nano_banana'
        },
        migrations: {
            directory: './migrations'
        },
        seeds: {
            directory: './seeds'
        },
        pool: {
            min: 2,
            max: 20, // Increased max connections
            acquireTimeoutMillis: 60000, // 60 seconds timeout
            propagateCreateError: false
        }
    },
    production: {
        client: 'pg',
        connection: process.env.DATABASE_URL,
        migrations: {
            directory: './migrations'
        },
        seeds: {
            directory: './seeds'
        },
        pool: {
            min: 2,
            max: 20,
            acquireTimeoutMillis: 60000,
            propagateCreateError: false
        },
        ssl: { rejectUnauthorized: false }
    }
};
