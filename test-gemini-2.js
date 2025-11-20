const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const fs = require('fs');

async function testGemini2() {
    const modelsToTest = [
        'gemini-2.0-flash-exp-image-generation',
        'gemini-2.5-flash-image-preview',
        'gemini-3-pro-image-preview'
    ];

    const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // 1x1 red pixel
    let logOutput = '';

    for (const modelName of modelsToTest) {
        const msg = `\n🧪 Testing ${modelName}...`;
        console.log(msg);
        logOutput += msg + '\n';

        const model = genAI.getGenerativeModel({ model: modelName });

        try {
            const attemptMsg = '  Attempting Image-to-Image (Editing)...';
            console.log(attemptMsg);
            logOutput += attemptMsg + '\n';
            const result = await model.generateContent([
                {
                    inlineData: {
                        data: base64Png,
                        mimeType: 'image/png'
                    }
                },
                { text: 'Make it blue' }
            ], {
                // generationConfig: { response_modalities: ['IMAGE'] }
            });

            const response = await result.response;

            if (response.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
                const successMsg = `  ✅ ${modelName}: Image edited successfully!`;
                console.log(successMsg);
                logOutput += successMsg + '\n';
            } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
                const textMsg = `  ℹ️ ${modelName}: Returned text: "${response.candidates[0].content.parts[0].text.substring(0, 50)}..."`;
                console.log(textMsg);
                logOutput += textMsg + '\n';
            } else {
                const failMsg = `  ❌ ${modelName}: No output. Finish reason: ${response.candidates?.[0]?.finishReason}`;
                console.log(failMsg);
                logOutput += failMsg + '\n';
            }
        } catch (error) {
            const errorMsg = `  ❌ ${modelName} Error: ${error.message}`;
            console.error(errorMsg);
            logOutput += errorMsg + '\n';
        }
    }

    fs.writeFileSync('test_results.txt', logOutput);
}

testGemini2();
