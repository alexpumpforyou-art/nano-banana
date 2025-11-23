/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema
        .createTable('users', function (table) {
            table.increments('id').primary();
            table.string('telegram_id').unique().notNullable();
            table.string('username');
            table.string('first_name');
            table.string('last_name');
            table.integer('credits').defaultTo(5); // FREE_CREDITS default
            table.integer('generations_count').defaultTo(0);
            table.boolean('is_blocked').defaultTo(false);
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('last_activity').defaultTo(knex.fn.now());
        })
        .createTable('transactions', function (table) {
            table.increments('id').primary();
            table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
            table.string('type').notNullable(); // 'purchase', 'generation', 'referral', 'bonus'
            table.integer('amount').notNullable();
            table.float('price').defaultTo(0);
            table.string('currency').defaultTo('RUB');
            table.string('description');
            table.timestamp('created_at').defaultTo(knex.fn.now());
        })
        .createTable('generations', function (table) {
            table.increments('id').primary();
            table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
            table.text('prompt');
            table.text('result');
            table.integer('cost').defaultTo(0);
            table.string('type').defaultTo('text'); // 'text', 'image', 'image_edit'
            table.text('image_data'); // Base64 or URL
            table.timestamp('created_at').defaultTo(knex.fn.now());
        })
        .createTable('referrals', function (table) {
            table.increments('id').primary();
            table.integer('referrer_id').references('id').inTable('users').onDelete('CASCADE');
            table.integer('referred_id').references('id').inTable('users').onDelete('CASCADE');
            table.string('code');
            table.string('status').defaultTo('pending');
            table.timestamp('created_at').defaultTo(knex.fn.now());
        })
        .createTable('content', function (table) {
            table.increments('id').primary();
            table.string('type').notNullable();
            table.string('title');
            table.text('text');
            table.text('image_data');
            table.integer('order_index').defaultTo(0);
            table.boolean('is_active').defaultTo(true);
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
        });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('content')
        .dropTableIfExists('referrals')
        .dropTableIfExists('generations')
        .dropTableIfExists('transactions')
        .dropTableIfExists('users');
};
