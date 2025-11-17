require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  console.log('🔍 Проверка доступных моделей Gemini...\n');
  
  const apiKey = process.env.GEMINI_API_KEY;
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Попробуем v1beta API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    
    const data = await response.json();
    
    if (data.models) {
      console.log('✅ Доступные модели:\n');
      data.models.forEach(model => {
        if (model.name.includes('gemini')) {
          console.log(`  📌 ${model.name.replace('models/', '')}`);
          if (model.supportedGenerationMethods) {
            console.log(`     Методы: ${model.supportedGenerationMethods.join(', ')}`);
          }
        }
      });
      
      // Находим первую рабочую модель
      const workingModel = data.models.find(m => 
        m.name.includes('gemini') && 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      if (workingModel) {
        console.log(`\n✅ Рекомендуемая модель: ${workingModel.name.replace('models/', '')}`);
        
        // Тестируем её
        console.log('\n🧪 Тестирую рекомендуемую модель...');
        const modelName = workingModel.name.replace('models/', '');
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Скажи привет!');
        const text = result.response.text();
        console.log(`✅ РАБОТАЕТ! Ответ: ${text}`);
      }
    } else {
      console.error('❌ Не удалось получить список моделей');
      console.error('Ответ:', data);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

listModels();

