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
            max: 10
        }
    }
};
