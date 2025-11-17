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
      
      const result = await this.imageModel.generateContent(prompt);
      const response = await result.response;
      
      // Получаем сгенерированное изображение
      const imageData = response.text();
      
      // Примерный подсчет токенов
      const tokensUsed = Math.ceil(prompt.length / 4);

      console.log(`✅ Изображение сгенерировано успешно`);
      
      return {
        imageData,
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

