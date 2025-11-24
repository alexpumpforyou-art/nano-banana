const knexConfig = require('./knexfile');
const knex = require('knex')(knexConfig[process.env.NODE_ENV || 'development']);

// Генератор реферальных кодов
function generateReferralCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const userQueries = {
    async getOrCreateTelegramUser(telegramId, username, credits, referralCode) {
        const existing = await knex('users').where('telegram_id', telegramId).first();
        if (existing) {
            const [updated] = await knex('users')
                .where('telegram_id', telegramId)
                .update({
                    username,
                    last_activity: knex.fn.now()
                })
                .returning('*');
            return updated;
        }
        const [created] = await knex('users')
            .insert({
                telegram_id: telegramId,
                username,
                credits,
                referral_code: referralCode || null
            })
            .returning('*');
        return created;
    },

    async getOrCreateWebUser(webId, credits, referralCode) {
        // Not fully implemented in original, but following pattern
        return null;
    },

    async getByTelegramId(telegramId) {
        return knex('users').where('telegram_id', telegramId).first();
    },

    async getByWebId(webId) {
        return knex('users').where('web_id', webId).first();
    },

    async getByReferralCode(code) {
        return knex('users').where('referral_code', code).first();
    },

    async updateCredits(amount, userId) {
        return knex('users')
            .where('id', userId)
            .increment('credits', amount);
    },

    async incrementGenerations(creditsSpent, userId) {
        return knex('users')
            .where('id', userId)
            .increment('generations_count', 1)
            .increment('total_spent_credits', creditsSpent || 0); // Assuming column name match
    },

    async setReferrer(referrerId, userId) {
        return knex('users')
            .where('id', userId)
            .update('referred_by', referrerId);
    },

    async addReferralBonus(bonus, credits, userId) {
        return knex('users')
            .where('id', userId)
            .increment('referral_bonus_earned', bonus)
            .increment('credits', credits);
    },

    async setBlocked(isBlocked, userId) {
        return knex('users')
            .where('id', userId)
            .update('is_blocked', isBlocked ? true : false);
    },

    async getBalance(userId) {
        const user = await knex('users').select('credits').where('id', userId).first();
        return user ? { credits: user.credits } : null;
    },

    async getReferrals(referrerId) {
        return knex('users')
            .select('id', 'username', 'telegram_id', 'created_at', 'generations_count as total_generations')
            .where('referred_by', referrerId)
            .orderBy('created_at', 'desc');
    },

    async countReferrals(referrerId) {
        const result = await knex('users').count('* as count').where('referred_by', referrerId).first();
        return { count: parseInt(result.count) };
    },

    async getAllUsers() {
        return knex('users')
            .select('*', knex.raw('generations_count as total_generations'))
            .orderBy('created_at', 'desc');
    },

    async getAdminUserById(id) {
        return knex('users')
            .select('*', knex.raw('generations_count as total_generations'))
            .where('id', id)
            .first();
    },

    async getTotalStats() {
        const result = await knex('users')
            .select(
                knex.raw('COUNT(*) as total_users'),
                knex.raw('COUNT(CASE WHEN telegram_id IS NOT NULL THEN 1 END) as telegram_users'),
                knex.raw('COUNT(CASE WHEN is_blocked = true THEN 1 END) as blocked_users'),
                knex.raw('SUM(generations_count) as total_generations'),
                knex.raw('SUM(credits) as total_credits_balance')
            )
            .first();
        return result;
    },

    async getRequests(limit) {
        return knex('generations as g')
            .join('users as u', 'g.user_id', 'u.id')
            .select(
                'g.id',
                'g.prompt',
                'g.result as response',
                'g.cost as credits_used',
                'g.type',
                // 'g.image_data', // Exclude heavy image data from list view
                'g.created_at',
                'u.id as user_id',
                'u.username',
                'u.telegram_id',
                'u.web_id'
            )
            .orderBy('g.created_at', 'desc')
            .limit(limit);
    },

    async getUsersForBroadcast(filters) {
        let query = knex('users').select('id', 'telegram_id', 'username', 'is_blocked').whereNotNull('telegram_id');

        if (filters) {
            if (filters.onlyActive === true) {
                query = query.where('is_blocked', false);
            }
            if (filters.onlyBlocked === true) {
                query = query.where('is_blocked', true);
            }
            if (filters.minCredits !== undefined && filters.minCredits !== null) {
                query = query.where('credits', '>=', parseInt(filters.minCredits));
            }
            if (filters.maxCredits !== undefined && filters.maxCredits !== null) {
                query = query.where('credits', '<=', parseInt(filters.maxCredits));
            }
        }

        return query;
    }
};

const transactionQueries = {
    async create(userId, type, amount, starsPaid, description) {
        return knex('transactions').insert({
            user_id: userId,
            type,
            amount,
            price: starsPaid, // Mapping stars_paid to price/amount logic if needed, or add column
            description
        });
    },

    async getHistory(userId, limit) {
        return knex('transactions')
            .where('user_id', userId)
            .orderBy('created_at', 'desc')
            .limit(limit);
    },

    async getAllByUserId(userId) {
        return knex('transactions')
            .where('user_id', userId)
            .orderBy('created_at', 'desc');
    },

    async getTotalStats() {
        return knex('transactions')
            .select(
                knex.raw('COUNT(*) as total_transactions'),
                knex.raw("SUM(CASE WHEN type = 'purchase' THEN price ELSE 0 END) as total_stars_received"),
                knex.raw("SUM(CASE WHEN type = 'purchase_yookassa' THEN price ELSE 0 END) as total_rub_received")
            )
            .first();
    }
};

const generationQueries = {
    async create(userId, prompt, response, creditsUsed, type, imageData) {
        return knex('generations').insert({
            user_id: userId,
            prompt,
            result: response,
            cost: creditsUsed,
            type,
            image_data: imageData
        });
    },

    async getGenerationImage(id) {
        return knex('generations')
            .select('image_data')
            .where('id', id)
            .first();
    },

    async getHistory(userId, limit) {
        return knex('generations')
            .select('id', 'prompt', knex.raw('SUBSTRING(result, 1, 100) as response_preview'), 'cost as credits_used', 'type', 'created_at')
            .where('user_id', userId)
            .orderBy('created_at', 'desc')
            .limit(limit);
    },

    async getAllByUserId(userId) {
        return knex('generations')
            .where('user_id', userId)
            .orderBy('created_at', 'desc');
    },

    async countByType() {
        return knex('generations')
            .select('type')
            .count('* as count')
            .sum('cost as total_credits')
            .groupBy('type');
    }
};

const referralQueries = {
    async create(referrerId, referredId, bonusEarned) {
        return knex('referrals').insert({
            referrer_id: referrerId,
            referred_id: referredId,
            bonus_earned: bonusEarned || 0
        });
    },

    async getByReferrer(referrerId) {
        return knex('referrals')
            .where('referrer_id', referrerId)
            .orderBy('created_at', 'desc');
    },

    async getTotalBonus(referrerId) {
        const result = await knex('referrals')
            .sum('bonus_earned as total')
            .where('referrer_id', referrerId)
            .first();
        return { total: result.total || 0 };
    }
};

const contentQueries = {
    async getAll() {
        return knex('content').orderBy('order_index', 'asc');
    },

    async getAllByType(type) {
        return knex('content').where('type', type).orderBy('order_index', 'asc');
    },

    async getByType(type) {
        return knex('content').where('type', type).orderBy('order_index', 'asc').first();
    },

    async getById(id) {
        return knex('content').where('id', id).first();
    },

    async create(type, title, text, image_data, order_index, is_active) {
        const [created] = await knex('content').insert({
            type,
            title,
            text,
            image_data,
            order_index,
            is_active: is_active ? 1 : 0
        }).returning('*');
        return created;
    },

    async update(title, text, image_data, order_index, is_active, id) {
        const [updated] = await knex('content')
            .where('id', id)
            .update({
                title,
                text,
                image_data,
                order_index,
                is_active: is_active ? 1 : 0,
                updated_at: knex.fn.now()
            })
            .returning('*');
        return updated;
    },

    async delete(id) {
        return knex('content').where('id', id).del();
    }
};

module.exports = {
    knex,
    generateReferralCode,
    userQueries,
    transactionQueries,
    generationQueries,
    referralQueries,
    contentQueries
};
