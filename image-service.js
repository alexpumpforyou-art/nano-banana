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
      'gemini-2.5-flash-image',            // User confirmed working model!
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

    console.error('❌ Unexpected REST response structure:', JSON.stringify(data, null, 2));
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
          if (response.candidates && response.candidates[0] && response.candidates[0].content) {
            console.error('Response content:', JSON.stringify(response.candidates[0].content, null, 2));
          }
          if (response.promptFeedback) {
            console.error('Prompt feedback:', JSON.stringify(response.promptFeedback, null, 2));
          }
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
    // Reset edit index if needed or keep persistent? Better reset for each request to start with best model
    this.currentEditModelIndex = 0;

    for (let attempt = 0; attempt < this.editingModels.length; attempt++) {
      try {
        const modelName = this.editingModels[this.currentEditModelIndex];
        console.log(`✏️ Редактирую изображение через модель: ${modelName}`);
        console.log(`   Промпт: "${prompt}"`);

        let editedImageBuffer = null;

        if (modelName.startsWith('imagen-')) {
          // Use REST API for Imagen
          editedImageBuffer = await this.editImageViaRest(modelName, imageBuffer, prompt);
        } else {
          // Use Gemini SDK
          // Конвертируем изображение в base64
          const base64Image = imageBuffer.toString('base64');

          // Формируем детальный промпт для редактирования
          const editPrompt = `Отредактируй это изображение: ${prompt}. \nВАЖНО: Сохрани все существующие элементы и детали изображения, только добавь или измени то, что указано в запросе. \nНе создавай новое изображение с нуля, а именно модифицируй это.`;

          // Используем Gemini модель для редактирования
          const editModel = this.genAI.getGenerativeModel({ model: modelName });

          const result = await editModel.generateContent([
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/jpeg' // или определять автоматически
              }
            },
            { text: editPrompt }
          ], {
            // generationConfig: {
            //   response_modalities: ['IMAGE'] // Убираем ограничение, чтобы видеть текст ошибки если есть
            // },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
          });

          const response = await result.response;

          console.log('📋 Структура ответа (редактирование):');
          console.log('response.candidates:', response.candidates?.length || 0);
          if (response.promptFeedback) {
            console.log('⚠️ Prompt Feedback:', JSON.stringify(response.promptFeedback, null, 2));
          }

          if (response.candidates && response.candidates[0]) {
            const candidate = response.candidates[0];

            if (candidate.finishReason !== 'STOP') {
              console.log('⚠️ Finish Reason:', candidate.finishReason);
            }

            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                if (part.inlineData && part.inlineData.data) {
                  editedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
                  console.log(`✅ Изображение отредактировано (${part.inlineData.mimeType}, ${editedImageBuffer.length} bytes)`);
                  break;
                } else if (part.text) {
                  console.log(`ℹ️ Модель вернула текст вместо изображения: "${part.text}"`);
                }
              }
            }
          }
        }

        if (!editedImageBuffer) {
          console.error(`❌ Модель ${modelName} не вернула отредактированное изображение`);
          throw new Error('Модель вернула пустой результат (возможно, только текст)');
        }

        const tokensUsed = Math.ceil(prompt.length / 4) + 50;

        return {
          imageBuffer: editedImageBuffer,
          tokensUsed,
          success: true
        };

      } catch (error) {
        console.error(`❌ Ошибка редактирования с моделью ${this.editingModels[this.currentEditModelIndex]}:`, error.message);

        this.currentEditModelIndex++;
        if (this.currentEditModelIndex < this.editingModels.length) {
          console.log(`🔄 Переключаюсь на модель: ${this.editingModels[this.currentEditModelIndex]}`);
          continue;
        }

        // Если это была последняя модель и она не сработала
        if (this.currentEditModelIndex >= this.editingModels.length) {
          throw new Error('Не удалось отредактировать изображение: ' + error.message);
        }
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

