require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  console.log('🧪 Тестирование Gemini API...\n');
  
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('🔑 API Key:', apiKey ? apiKey.substring(0, 20) + '...' : '❌ НЕ НАЙДЕН');
  
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY не найден в .env файле!');
    process.exit(1);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Попробуем разные версии модели
    const models = ['gemini-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    
    for (const modelName of models) {
      console.log(`\n📡 Тестирую модель: ${modelName}...`);
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Привет! Ответь одним словом: работает?');
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ Модель ${modelName} РАБОТАЕТ!`);
        console.log(`📝 Ответ: ${text}`);
        console.log('🎉 Используйте эту модель!\n');
        break;
      } catch (error) {
        console.log(`❌ Модель ${modelName} не работает: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error('\n🔍 Детали:', error);
    
    if (error.message.includes('API_KEY_INVALID')) {
      console.error('\n💡 Решение: Проверьте API ключ на https://makersuite.google.com/app/apikey');
    }
    if (error.message.includes('models/gemini-pro')) {
      console.error('\n💡 Решение: Попробуйте модель gemini-1.5-flash вместо gemini-pro');
    }
  }
}

testGemini();

