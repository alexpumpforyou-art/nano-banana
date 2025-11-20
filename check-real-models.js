require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env');
    process.exit(1);
}

async function listModels() {
    try {
        console.log('🔄 Fetching available models...');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.error) {
            console.error('❌ Error listing models:', data.error);
            return;
        }

        console.log('✅ Available Models:');
        if (data.models) {
            data.models.forEach(m => {
                // Filter for relevant models to reduce noise, or just print all concisely
                if (m.name.includes('gemini') || m.name.includes('imagen')) {
                    console.log(`${m.name} | Methods: ${m.supportedGenerationMethods}`);
                }
            });
        } else {
            console.log('No models found.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

listModels();
