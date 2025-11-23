require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

// Create a simple white image for testing
const width = 100;
const height = 100;
const buffer = Buffer.alloc(width * height * 4); // RGBA
for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 255;     // R
    buffer[i + 1] = 255; // G
    buffer[i + 2] = 255; // B
    buffer[i + 3] = 255; // A
}
// We need a real image format, let's use a small base64 png
const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // Red dot
const imageBuffer = Buffer.from(base64Image, 'base64');

const modelsToTest = [
    'gemini-3-pro-preview',
    'gemini-2.0-flash-exp',
    'imagen-4.0-generate-001' // We know this fails, but good to confirm
];

async function testEdit(modelName) {
    console.log(`\n🧪 Testing model: ${modelName}`);
    try {
        if (modelName.startsWith('imagen-')) {
            // Test REST API
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{
                        prompt: "Make it blue",
                        image: { bytesBase64Encoded: base64Image }
                    }],
                    parameters: { sampleCount: 1 }
                })
            });

            if (!response.ok) {
                const text = await response.text();
                console.log(`❌ REST API Error: ${response.status} - ${text}`);
            } else {
                const data = await response.json();
                console.log('✅ REST API Success:', data.predictions ? 'Got predictions' : 'No predictions');
            }

        } else {
            // Test SDK
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                { inlineData: { data: base64Image, mimeType: 'image/png' } },
                { text: "Make it blue" }
            ], { generationConfig: { response_modalities: ['IMAGE'] } });

            const response = await result.response;
            console.log('✅ SDK Success. Candidates:', response.candidates?.length);
            if (response.candidates?.[0]?.content?.parts) {
                response.candidates[0].content.parts.forEach(p => {
                    console.log('  Part:', p.text ? 'Text' : (p.inlineData ? 'Image' : 'Unknown'));
                });
            }
        }
    } catch (e) {
        console.log(`❌ Error: ${e.message}`);
    }
}

async function run() {
    for (const m of modelsToTest) {
        await testEdit(m);
    }
}

run();
