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
    this.editingModels = [
      'gemini-2.0-flash-exp',      // Multimodal (Image+Text -> Text/Image?)
      'gemini-1.5-pro-latest',     // Verified latest version
      'gemini-1.5-flash-latest',   // Verified latest version
      'gemini-1.5-pro',            // Fallback
      'gemini-1.5-flash'           // Fallback
    ];

    this.currentModelIndex = 0;
    this.currentEditModelIndex = 0; // Separate index for editing

    this.imageModel = this.genAI.getGenerativeModel({
      model: this.modelsToTry[this.currentModelIndex]
    });
  }

  // ... (existing methods)

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
          generationConfig: {
            response_modalities: ['IMAGE']
          },
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

