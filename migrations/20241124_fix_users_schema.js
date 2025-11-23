/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.table('users', function (table) {
        table.string('web_id').unique();
        table.string('referral_code').unique();
        table.integer('referred_by').references('id').inTable('users');
        table.integer('referral_bonus_earned').defaultTo(0);
        table.integer('total_spent_credits').defaultTo(0);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.table('users', function (table) {
        table.dropColumn('total_spent_credits');
        table.dropColumn('referral_bonus_earned');
        table.dropColumn('referred_by');
        table.dropColumn('referral_code');
        table.dropColumn('web_id');
    });
};
