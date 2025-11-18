require('dotenv').config();
const https = require('https');

async function checkGemini3Models() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY не установлен в .env');
    return;
  }
  
  console.log('🔍 Проверяю доступные модели Gemini (включая Gemini 3)...\n');
  console.log(`🔑 API Key: ${apiKey.substring(0, 20)}...\n`);
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    
    if (data.error) {
      console.error('❌ Ошибка API:', data.error.message);
      return;
    }
    
    if (!data.models || data.models.length === 0) {
      console.log('❌ Нет доступных моделей');
      return;
    }
    
    console.log(`✅ Найдено моделей: ${data.models.length}\n`);
    
    // Фильтруем модели Gemini 3
    const gemini3Models = data.models.filter(m => 
      m.name.includes('gemini-3') || 
      m.name.includes('gemini-3.0') || 
      m.name.includes('gemini-3.5')
    );
    
    // Фильтруем модели для текста
    const textModels = data.models.filter(m => 
      m.supportedGenerationMethods?.includes('generateContent') &&
      !m.name.toLowerCase().includes('image')
    );
    
    // Фильтруем модели для изображений
    const imageModels = data.models.filter(m => 
      m.name.toLowerCase().includes('image') &&
      m.supportedGenerationMethods?.includes('generateContent')
    );
    
    console.log('📊 GEMINI 3 МОДЕЛИ:\n');
    if (gemini3Models.length > 0) {
      gemini3Models.forEach(model => {
        const name = model.name.replace('models/', '');
        console.log(`  ✅ ${name}`);
        if (model.displayName) console.log(`     ${model.displayName}`);
        console.log(`     Методы: ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  Модели Gemini 3 не найдены (возможно еще не доступны для вашего ключа)\n');
    }
    
    console.log('📝 РЕКОМЕНДУЕМЫЕ МОДЕЛИ ДЛЯ ТЕКСТА:\n');
    const recommendedText = textModels
      .filter(m => m.name.includes('gemini-3') || m.name.includes('gemini-2.5') || m.name.includes('gemini-2.0'))
      .slice(0, 10);
    
    recommendedText.forEach((model, i) => {
      const name = model.name.replace('models/', '');
      const isGemini3 = name.includes('gemini-3');
      console.log(`  ${i + 1}. ${isGemini3 ? '🆕 ' : ''}${name}`);
    });
    
    console.log('\n🖼️  РЕКОМЕНДУЕМЫЕ МОДЕЛИ ДЛЯ ИЗОБРАЖЕНИЙ:\n');
    const recommendedImage = imageModels
      .filter(m => m.name.includes('gemini-3') || m.name.includes('gemini-2.5') || m.name.includes('gemini-2.0'))
      .slice(0, 10);
    
    if (recommendedImage.length > 0) {
      recommendedImage.forEach((model, i) => {
        const name = model.name.replace('models/', '');
        const isGemini3 = name.includes('gemini-3');
        console.log(`  ${i + 1}. ${isGemini3 ? '🆕 ' : ''}${name}`);
      });
    } else {
      console.log('  ⚠️  Модели для изображений не найдены\n');
    }
    
    // Проверяем версию SDK
    console.log('\n📦 ПРОВЕРКА SDK:\n');
    try {
      const sdk = require('@google/generative-ai/package.json');
      console.log(`  Текущая версия: ${sdk.version}`);
      console.log(`  Рекомендуется: ^0.24.1 или новее для поддержки Gemini 3`);
    } catch (e) {
      console.log('  ⚠️  Не удалось проверить версию SDK');
    }
    
    console.log('\n💡 РЕКОМЕНДАЦИИ:\n');
    if (gemini3Models.length > 0) {
      console.log('  ✅ Модели Gemini 3 доступны! Обновите код для использования новых моделей.');
    } else {
      console.log('  ⚠️  Модели Gemini 3 пока не доступны для вашего API ключа.');
      console.log('  💡 Возможно нужно обновить API ключ или подождать пока Google развернет Gemini 3.');
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

checkGemini3Models();

