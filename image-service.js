const { GoogleGenerativeAI } = require('@google/generative-ai');

class ImageService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Используем модель для генерации изображений
    this.imageModel = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp-image-generation'
    });
  }

  /**
   * Генерация изображения по текстовому описанию
   * @param {string} prompt - Описание желаемого изображения
   * @returns {Promise<{imageData: string, tokensUsed: number}>}
   */
  async generateImage(prompt) {
    try {
      console.log(`🎨 Генерирую изображение: "${prompt}"`);
      
      // Генерируем изображение с правильной конфигурацией
      const result = await this.imageModel.generateContent(prompt, {
        generationConfig: {
          response_modalities: ['IMAGE']
        }
      });
      
      const response = await result.response;
      
      // Получаем изображение из ответа
      let imageBuffer = null;
      
      // Проверяем разные возможные форматы ответа
      if (response.candidates && response.candidates[0]) {
        const candidate = response.candidates[0];
        
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.inlineData && part.inlineData.data) {
              // Изображение в base64
              imageBuffer = Buffer.from(part.inlineData.data, 'base64');
              console.log(`✅ Изображение получено (${part.inlineData.mimeType})`);
              break;
            }
          }
        }
      }
      
      if (!imageBuffer) {
        throw new Error('Изображение не найдено в ответе API');
      }
      
      // Примерный подсчет токенов
      const tokensUsed = Math.ceil(prompt.length / 4) + 50; // +50 за генерацию изображения

      console.log(`✅ Изображение сгенерировано успешно (${imageBuffer.length} bytes)`);
      
      return {
        imageBuffer,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('❌ Ошибка генерации изображения:', error.message);
      throw new Error('Не удалось сгенерировать изображение: ' + error.message);
    }
  }

  /**
   * Проверяет является ли запрос запросом на генерацию изображения
   * @param {string} text - Текст сообщения
   * @returns {boolean}
   */
  static isImageRequest(text) {
    const imageKeywords = [
      'нарисуй', 'нарисовать', 'рисунок', 'изображение',
      'картинку', 'картинка', 'фото', 'фотографию',
      'сгенерируй изображение', 'создай картинку',
      'покажи', 'визуализируй', 'иллюстрацию'
    ];
    
    const lowerText = text.toLowerCase();
    return imageKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Извлекает описание изображения из запроса
   * @param {string} text - Текст запроса
   * @returns {string}
   */
  static extractImagePrompt(text) {
    // Убираем ключевые слова команд
    let prompt = text
      .toLowerCase()
      .replace(/^(нарисуй|нарисовать|покажи|создай|сгенерируй)\s+/i, '')
      .replace(/^(картинку|фото|фотографию|изображение|рисунок)\s+/i, '')
      .trim();
    
    return prompt || text;
  }
}

module.exports = ImageService;

