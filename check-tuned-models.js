const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function checkTunedModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/tunedModels?key=${apiKey}`;

    console.log('🔄 Fetching tuned models...');

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.tunedModels) {
            console.log('✅ Tuned Models found:');
            data.tunedModels.forEach(model => {
                console.log(`- Name: ${model.name}`);
                console.log(`  Display Name: ${model.displayName}`);
                console.log(`  Base Model: ${model.baseModel}`);
                console.log(`  Description: ${model.description || 'No description'}`);
                console.log('---');
            });
        } else {
            console.log('ℹ️ No tuned models found (or empty list returned).');
            console.log('Raw response:', JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error('❌ Error fetching tuned models:', error.message);
    }
}

checkTunedModels();
