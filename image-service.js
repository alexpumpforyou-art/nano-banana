const { GoogleGenerativeAI } = require('@google/generative-ai');

class ImageService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Модели для генерации изображений (работают с SDK 0.24.1+)
    this.modelsToTry = [
      'gemini-2.0-flash-exp-image-generation',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-image-preview'
    ];
    this.currentModelIndex = 0;
    this.imageModel = this.genAI.getGenerativeModel({ 
      model: this.modelsToTry[this.currentModelIndex]
    });
  }

  /**
   * Генерация изображения по текстовому описанию
   * @param {string} prompt - Описание желаемого изображения
   * @returns {Promise<{imageData: string, tokensUsed: number}>}
   */
  async generateImage(prompt) {
    // Пробуем разные модели
    for (let attempt = 0; attempt < this.modelsToTry.length; attempt++) {
      try {
        const modelName = this.modelsToTry[this.currentModelIndex];
        console.log(`🎨 Генерирую изображение через модель: ${modelName}`);
        console.log(`   Промпт: "${prompt}"`);
        
        // Генерируем изображение с правильной конфигурацией
        const result = await this.imageModel.generateContent(prompt, {
          generationConfig: {
            response_modalities: ['IMAGE']
          }
        });
      
      const response = await result.response;
      
      // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ для отладки
      console.log('📋 Структура ответа API:');
      console.log('response.candidates:', response.candidates?.length || 0);
      if (response.candidates && response.candidates[0]) {
        const candidate = response.candidates[0];
        console.log('candidate.content:', !!candidate.content);
        console.log('candidate.content.parts:', candidate.content?.parts?.length || 0);
        
        if (candidate.content?.parts) {
          candidate.content.parts.forEach((part, i) => {
            console.log(`Part ${i} keys:`, Object.keys(part));
            if (part.text) console.log(`  - text: ${part.text.substring(0, 100)}...`);
            if (part.inlineData) console.log(`  - inlineData.mimeType: ${part.inlineData.mimeType}`);
          });
        }
      }
      
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
              console.log(`✅ Изображение получено (${part.inlineData.mimeType}, ${imageBuffer.length} bytes)`);
              break;
            }
          }
        }
      }
      
      if (!imageBuffer) {
        console.error(`❌ Модель ${this.modelsToTry[this.currentModelIndex]} вернула только текст, не изображение`);
        
        // Пробуем следующую модель
        this.currentModelIndex++;
        if (this.currentModelIndex < this.modelsToTry.length) {
          console.log(`🔄 Переключаюсь на модель: ${this.modelsToTry[this.currentModelIndex]}`);
          this.imageModel = this.genAI.getGenerativeModel({ 
            model: this.modelsToTry[this.currentModelIndex]
          });
          continue; // Пробуем следующую модель
        }
        
        throw new Error('Ни одна модель не смогла сгенерировать изображение. Все модели возвращают только текст.');
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
      console.error(`❌ Ошибка с моделью ${this.modelsToTry[this.currentModelIndex]}:`, error.message);
      
      // Пробуем следующую модель при ошибке
      this.currentModelIndex++;
      if (this.currentModelIndex < this.modelsToTry.length) {
        console.log(`🔄 Переключаюсь на модель: ${this.modelsToTry[this.currentModelIndex]}`);
        this.imageModel = this.genAI.getGenerativeModel({ 
          model: this.modelsToTry[this.currentModelIndex]
        });
        continue;
      }
      
      throw new Error('Не удалось сгенерировать изображение: ' + error.message);
    }
    }
    
    throw new Error('Ни одна модель генерации изображений не доступна для вашего API ключа');
  }

  /**
   * Редактирование изображения по текстовому описанию
   * @param {Buffer} imageBuffer - Исходное изображение
   * @param {string} prompt - Описание изменений
   * @returns {Promise<{imageBuffer: Buffer, tokensUsed: number}>}
   */
  async editImage(imageBuffer, prompt) {
    for (let attempt = 0; attempt < this.modelsToTry.length; attempt++) {
      try {
        const modelName = this.modelsToTry[this.currentModelIndex];
        console.log(`✏️ Редактирую изображение через модель: ${modelName}`);
        console.log(`   Промпт: "${prompt}"`);
        
        // Конвертируем изображение в base64
        const base64Image = imageBuffer.toString('base64');
        
        // Формируем детальный промпт для редактирования
        const editPrompt = `Отредактируй это изображение: ${prompt}. 
ВАЖНО: Сохрани все существующие элементы и детали изображения, только добавь или измени то, что указано в запросе. 
Не создавай новое изображение с нуля, а именно модифицируй это.`;
        
        // Отправляем изображение + промпт для редактирования
        const result = await this.imageModel.generateContent([
          {
            inlineData: {
              data: base64Image,
              mimeType: 'image/jpeg' // или определять автоматически
            }
          },
          { text: editPrompt }
        ], {
          generationConfig: {
            response_modalities: ['IMAGE']
          }
        });
        
        const response = await result.response;
        
        console.log('📋 Структура ответа (редактирование):');
        console.log('response.candidates:', response.candidates?.length || 0);
        
        // Получаем отредактированное изображение
        let editedImageBuffer = null;
        
        if (response.candidates && response.candidates[0]) {
          const candidate = response.candidates[0];
          
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData && part.inlineData.data) {
                editedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
                console.log(`✅ Изображение отредактировано (${part.inlineData.mimeType}, ${editedImageBuffer.length} bytes)`);
                break;
              }
            }
          }
        }
        
        if (!editedImageBuffer) {
          console.error(`❌ Модель ${modelName} не вернула отредактированное изображение`);
          
          // Пробуем следующую модель
          this.currentModelIndex++;
          if (this.currentModelIndex < this.modelsToTry.length) {
            console.log(`🔄 Переключаюсь на модель: ${this.modelsToTry[this.currentModelIndex]}`);
            this.imageModel = this.genAI.getGenerativeModel({ 
              model: this.modelsToTry[this.currentModelIndex]
            });
            continue;
          }
          
          throw new Error('Модель не смогла отредактировать изображение');
        }
        
        const tokensUsed = Math.ceil(prompt.length / 4) + 50;
        
        return {
          imageBuffer: editedImageBuffer,
          tokensUsed,
          success: true
        };
        
      } catch (error) {
        console.error(`❌ Ошибка редактирования с моделью ${this.modelsToTry[this.currentModelIndex]}:`, error.message);
        
        this.currentModelIndex++;
        if (this.currentModelIndex < this.modelsToTry.length) {
          console.log(`🔄 Переключаюсь на модель: ${this.modelsToTry[this.currentModelIndex]}`);
          this.imageModel = this.genAI.getGenerativeModel({ 
            model: this.modelsToTry[this.currentModelIndex]
          });
          continue;
        }
        
        throw new Error('Не удалось отредактировать изображение: ' + error.message);
      }
    }
    
    throw new Error('Ни одна модель не смогла отредактировать изображение');
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
   * Проверяет является ли запрос командой редактирования
   * @param {string} text - Текст сообщения
   * @returns {boolean}
   */
  static isImageEditRequest(text) {
    const editKeywords = [
      'добавь', 'дорисуй', 'измени', 'сделай',
      'убери', 'удали', 'нарисуй ему', 'нарисуй ей',
      'раскрась', 'перекрась', 'поменяй'
    ];
    
    const lowerText = text.toLowerCase();
    return editKeywords.some(keyword => lowerText.includes(keyword));
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

