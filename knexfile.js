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
        connection: {
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        },
        migrations: {
            directory: './migrations'
        },
        seeds: {
            directory: './seeds'
        },
        pool: {
            min: 0, // Allow startup without immediate connection
            max: 10, // Reduced to avoid overwhelming DB after incident
            acquireTimeoutMillis: 30000, // 30 seconds to acquire
            createTimeoutMillis: 30000, // 30 seconds to create
            idleTimeoutMillis: 30000, // Close idle connections after 30s
            reapIntervalMillis: 1000, // Check for idle connections every 1s
            propagateCreateError: false
        }
    }
};
