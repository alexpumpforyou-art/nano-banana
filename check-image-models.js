require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
  try {
    console.log('🔍 Проверяем доступные модели для изображений...\n');
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );
    
    const data = await response.json();
    
    if (data.models) {
      const imageModels = data.models.filter(m => 
        m.name.toLowerCase().includes('image') || 
        m.name.toLowerCase().includes('imagen') ||
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      console.log(`📊 Найдено ${imageModels.length} моделей связанных с изображениями:\n`);
      
      imageModels.forEach(model => {
        const modelName = model.name.replace('models/', '');
        console.log(`✅ ${modelName}`);
        console.log(`   Методы: ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
        console.log(`   Описание: ${model.description || 'N/A'}\n`);
      });
      
      // Также показываем все доступные модели с generateContent
      const allGenModels = data.models.filter(m => 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      console.log(`\n📋 Все модели с generateContent (${allGenModels.length}):\n`);
      allGenModels.forEach(m => {
        console.log(`  - ${m.name.replace('models/', '')}`);
      });
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

listModels();

