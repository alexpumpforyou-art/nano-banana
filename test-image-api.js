// Тестируем что именно возвращает Gemini image API
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testImageGeneration() {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  
  console.log('🎨 Тестирую генерацию изображений...\n');
  
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp-image-generation'
    });
    
    const result = await model.generateContent('пингвин на льдине');
    const response = await result.response;
    
    console.log('✅ Ответ получен!');
    console.log('\n📋 Структура ответа:');
    console.log(JSON.stringify(response, null, 2));
    
    console.log('\n📝 response.text():');
    try {
      const text = response.text();
      console.log(text);
    } catch (e) {
      console.log('Нет текста:', e.message);
    }
    
    console.log('\n📊 response.candidates:');
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      console.log('Candidate:', JSON.stringify(candidate, null, 2));
      
      if (candidate.content && candidate.content.parts) {
        console.log('\n🖼️ Parts:');
        candidate.content.parts.forEach((part, i) => {
          console.log(`Part ${i}:`, Object.keys(part));
          if (part.inlineData) {
            console.log('  - inlineData.mimeType:', part.inlineData.mimeType);
            console.log('  - inlineData.data (first 100 chars):', part.inlineData.data.substring(0, 100));
          }
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('Stack:', error.stack);
  }
}

testImageGeneration();


