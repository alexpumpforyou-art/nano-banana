const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null
});

const generationQueue = new Queue('image-generation', { connection });

module.exports = {
    generationQueue
};
