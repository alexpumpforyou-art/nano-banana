// Тест всех возможных моделей Gemini
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testAllModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Список моделей для проверки
  const modelsToTry = [
    'gemini-2.0-flash-exp',
    'gemini-exp-1206',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-pro',
  ];

  console.log('🔍 Тестирую все доступные модели Gemini...\n');

  for (const modelName of modelsToTry) {
    try {
      console.log(`📡 Тестирую: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const result = await model.generateContent('Скажи "работает"');
      const response = await result.response;
      const text = response.text();
      
      console.log(`✅ РАБОТАЕТ! Модель: ${modelName}`);
      console.log(`   Ответ: ${text}\n`);
      
      // Останавливаемся на первой рабочей модели
      console.log(`🎉 Используйте эту модель: ${modelName}\n`);
      break;
      
    } catch (error) {
      console.log(`❌ Не работает: ${error.message.substring(0, 100)}...\n`);
    }
  }
}

testAllModels().catch(console.error);


