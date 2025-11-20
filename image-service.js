const { GoogleGenerativeAI } = require('@google/generative-ai');

class ImageService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Модели для генерации изображений (приоритет: работающие → Gemini 3)
    // Gemini 3 пока может быть недоступна, поэтому пробуем сначала стабильные
    this.modelsToTry = [
      'imagen-4.0-generate-001',          // Imagen 4 (Latest)
      'imagen-4.0-ultra-generate-001',    // Imagen 4 Ultra
      'imagen-3.0-generate-001',          // Imagen 3
      'gemini-2.0-flash-exp'              // Fallback text-to-image
    ];

    // Модели специально для РЕДАКТИРОВАНИЯ (Image-to-Image)
    // Imagen 4 пока не поддерживает image input через predict, поэтому используем Gemini
    // Модели специально для РЕДАКТИРОВАНИЯ (Image-to-Image)
    // Imagen 4 поддерживает image input через predict
    this.editingModels = [
      'gemini-3-pro-preview',              // User suggested
      'gemini-2.5-pro',                    // User suggested
      'gemini-2.5-flash-image-preview',    // Experimental
      'gemini-2.0-flash-exp-image-generation', // Experimental
      'imagen-4.0-generate-preview-06-06', // Imagen 4 (Supports predict)
      'gemini-2.0-flash-exp'               // Fallback
    ];

    this.currentModelIndex = 0;
    this.currentEditModelIndex = 0; // Separate index for editing

    this.imageModel = this.genAI.getGenerativeModel({
      model: this.modelsToTry[this.currentModelIndex]
    });
  }

  /**
   * Редактирование изображения через REST API (для Imagen)
   */
  async editImageViaRest(modelName, imageBuffer, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${this.genAI.apiKey}`;
    const base64Image = imageBuffer.toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [{
          prompt: prompt,
          image: { bytesBase64Encoded: base64Image }
        }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1"
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`REST API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
      return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    }

    if (data.predictions && data.predictions[0] && data.predictions[0].mimeType && data.predictions[0].bytesBase64Encoded) {
      return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    }

    throw new Error('No image data in REST response');
  }

  /**
   * Генерация изображения через REST API (для моделей, поддерживающих только predict)
   */
  async generateImageViaRest(modelName, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${this.genAI.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [{ prompt: prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1"
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`REST API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
      return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    }

    if (data.predictions && data.predictions[0] && data.predictions[0].mimeType && data.predictions[0].bytesBase64Encoded) {
      return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    }

    throw new Error('No image data in REST response');
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

        let imageBuffer = null;

        // Если это Imagen модель, используем REST API predict
        if (modelName.startsWith('imagen-')) {
          try {
            imageBuffer = await this.generateImageViaRest(modelName, prompt);
            console.log(`✅ Изображение получено через REST API (${imageBuffer.length} bytes)`);
          } catch (restError) {
            console.error(`⚠️ Ошибка REST API для ${modelName}:`, restError.message);
            // Если ошибка 404 или 400, пробуем стандартный метод (на всякий случай) или следующую модель
            throw restError;
          }
        } else {
          // Стандартный метод для Gemini моделей
          const result = await this.imageModel.generateContent(prompt, {
            generationConfig: {
              response_modalities: ['IMAGE']
            }
          });

          const response = await result.response;
          if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                break;
              }
            }
          }
        }

        if (!imageBuffer) {
          console.error(`❌ Модель ${this.modelsToTry[this.currentModelIndex]} не вернула изображение`);
          throw new Error('Модель вернула пустой результат');
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
    // 1. Попытка нативного редактирования (Gemini 2.0)
    try {
      console.log(`✏️ Попытка нативного редактирования через gemini-2.0-flash-exp...`);
      const modelName = 'gemini-2.0-flash-exp';
      const base64Image = imageBuffer.toString('base64');
      const editPrompt = `Отредактируй это изображение: ${prompt}. \nВАЖНО: Сохрани все существующие элементы и детали изображения, только добавь или измени то, что указано в запросе. \nНе создавай новое изображение с нуля, а именно модифицируй это.`;

      const editModel = this.genAI.getGenerativeModel({ model: modelName });
      const result = await editModel.generateContent([
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg'
          }
        },
        { text: editPrompt }
      ], {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      });

      const response = await result.response;

      if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            console.log(`✅ Нативное редактирование успешно!`);
            const editedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
            const tokensUsed = Math.ceil(prompt.length / 4) + 50;
            return { imageBuffer: editedImageBuffer, tokensUsed, success: true };
          }
        }
      }
      console.warn('⚠️ Нативное редактирование не вернуло изображение, переходим к fallback...');
    } catch (error) {
      console.error('⚠️ Ошибка нативного редактирования:', error.message);
      // Fallback continues below
    }

    // 2. Fallback: Describe + Generate (Имитация редактирования)
    // Используем Gemini 2.0 Flash для описания картинки с учетом изменений, затем Imagen 4 для генерации
    try {
      console.log(`🔄 Запуск Fallback: Describe + Generate...`);

      // Шаг 1: Описание новой картинки
      const describeModel = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const base64Image = imageBuffer.toString('base64');
      const describePrompt = `Посмотри на это изображение. Пользователь хочет изменить его так: "${prompt}".
      
      Опиши ОЧЕНЬ ПОДРОБНО, как должно выглядеть итоговое изображение. 
      Включи в описание все детали оригинального изображения (стиль, цвета, композицию, объекты), но с внесенными изменениями.
      Описание должно быть на английском языке для лучшей генерации.
      Верни ТОЛЬКО описание, без лишних слов.`;

      const describeResult = await describeModel.generateContent([
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg'
          }
        },
        { text: describePrompt }
      ]);

      const newPrompt = describeResult.response.text();
      console.log(`📝 Сгенерирован новый промпт для генерации: "${newPrompt.substring(0, 100)}..."`);

      // Шаг 2: Генерация новой картинки по описанию
      // Используем существующий метод generateImage, который сам выберет лучшую модель (Imagen 4)
      const generationResult = await this.generateImage(newPrompt);

      console.log(`✅ Fallback редактирование успешно!`);
      return {
        imageBuffer: generationResult.imageBuffer,
        tokensUsed: generationResult.tokensUsed + 50, // Доп. токены за описание
        success: true
      };

    } catch (fallbackError) {
      console.error('❌ Ошибка Fallback редактирования:', fallbackError.message);
      throw new Error('Не удалось отредактировать изображение даже через fallback: ' + fallbackError.message);
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

