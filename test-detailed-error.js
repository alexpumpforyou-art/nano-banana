require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testDetailed() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('🔑 API Key:', apiKey ? `${apiKey.substring(0, 20)}...` : 'НЕ НАЙДЕН');
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  try {
    console.log('\n📡 Отправляю запрос к Gemini...\n');
    const result = await model.generateContent('Привет!');
    const response = await result.response;
    const text = response.text();
    
    console.log('✅ РАБОТАЕТ!');
    console.log('Ответ:', text);
    
  } catch (error) {
    console.error('❌ ОШИБКА:\n');
    console.error('Сообщение:', error.message);
    console.error('\nПолная ошибка:', JSON.stringify(error, null, 2));
    
    if (error.message.includes('User location is not supported')) {
      console.log('\n💡 РЕШЕНИЕ: API ключ заблокирован для вашего региона.');
      console.log('   Нужно создать новый ключ через VPN или использовать другой API.');
    }
    if (error.message.includes('API_KEY_INVALID')) {
      console.log('\n💡 РЕШЕНИЕ: API ключ недействителен. Создайте новый на https://aistudio.google.com/apikey');
    }
  }
}

testDetailed();


