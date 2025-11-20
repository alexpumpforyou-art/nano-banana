require('dotenv').config();
const fetch = require('node-fetch');

async function listAvailableModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  console.log('🔍 Получаю список ДОСТУПНЫХ моделей для вашего API ключа...\n');
  
  try {
    // Пробуем v1beta
    const urlBeta = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const responseBeta = await fetch(urlBeta);
    const dataBeta = await responseBeta.json();
    
    if (dataBeta.error) {
      console.error('❌ Ошибка v1beta:', dataBeta.error.message);
      
      // Пробуем v1
      console.log('\n Пробую v1...');
      const urlV1 = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
      const responseV1 = await fetch(urlV1);
      const dataV1 = await responseV1.json();
      
      if (dataV1.error) {
        console.error('❌ Ошибка v1:', dataV1.error.message);
        console.log('\n💡 API ключ заблокирован или недействителен!');
        return;
      }
      
      console.log('✅ v1 работает!');
      printModels(dataV1);
      
    } else {
      console.log('✅ v1beta работает!');
      printModels(dataBeta);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

function printModels(data) {
  if (!data.models || data.models.length === 0) {
    console.log('❌ Нет доступных моделей!');
    return;
  }
  
  console.log(`\n📋 Доступно моделей: ${data.models.length}\n`);
  
  data.models.forEach(model => {
    const name = model.name.replace('models/', '');
    const methods = model.supportedGenerationMethods || [];
    
    if (methods.includes('generateContent')) {
      console.log(`✅ ${name}`);
      console.log(`   Методы: ${methods.join(', ')}`);
      if (model.displayName) console.log(`   Название: ${model.displayName}`);
      console.log('');
    }
  });
}

listAvailableModels();


