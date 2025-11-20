// Получаем РЕАЛЬНЫЙ список доступных моделей напрямую от Google API
require('dotenv').config();
const fetch = require('node-fetch');

async function getRealModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  console.log('🔍 Получаю РЕАЛЬНЫЙ список моделей от Google API...\n');
  console.log(`🔑 Ключ: ${apiKey.substring(0, 20)}...\n`);
  
  try {
    // Пробуем v1beta
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error('❌ Ошибка:', data.error.message);
      return;
    }
    
    if (!data.models || data.models.length === 0) {
      console.log('❌ Нет доступных моделей!');
      return;
    }
    
    console.log(`✅ Найдено моделей: ${data.models.length}\n`);
    console.log('📋 ДОСТУПНЫЕ МОДЕЛИ:\n');
    
    const workingModels = [];
    
    data.models.forEach(model => {
      const name = model.name.replace('models/', '');
      const methods = model.supportedGenerationMethods || [];
      
      if (methods.includes('generateContent')) {
        workingModels.push(name);
        console.log(`✅ ${name}`);
        if (model.displayName) {
          console.log(`   Название: ${model.displayName}`);
        }
        console.log(`   Методы: ${methods.join(', ')}`);
        console.log('');
      }
    });
    
    if (workingModels.length > 0) {
      console.log('\n🎯 ИСПОЛЬЗУЙТЕ ОДНУ ИЗ ЭТИХ МОДЕЛЕЙ:\n');
      workingModels.forEach((m, i) => {
        console.log(`${i + 1}. ${m}`);
      });
      console.log(`\n💡 Рекомендую: ${workingModels[0]}\n`);
    } else {
      console.log('❌ Ни одна модель не поддерживает generateContent');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

getRealModels();


