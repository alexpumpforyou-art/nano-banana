const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.apiKey = apiKey;
    // Список моделей для автоматического перебора (приоритет: работающие → Gemini 3)
    // Gemini 3 пока может быть недоступна, поэтому пробуем сначала стабильные
    this.modelsToTry = [
      'gemini-3.0-pro',            // Самая мощная модель (Nov 2025)
      'gemini-3.0-flash',          // Быстрая новая модель
      'gemini-2.5-pro',            // Стабильная мощная (fallback)
      'gemini-2.5-flash',          // Стабильная быстрая
      'gemini-2.0-flash',          // Предыдущее поколение
      'gemini-1.5-pro',            // Legacy fallback
      'gemini-1.5-flash'           // Legacy fallback
    ];
    this.currentModelIndex = 0;
    this.model = this.genAI.getGenerativeModel({
      model: this.modelsToTry[this.currentModelIndex]
    });
  }

  /**
   * Генерация текста через Gemini API
   * @param {string} prompt - Текст запроса
   * @returns {Promise<{text: string, tokensUsed: number}>}
   */
  async generate(prompt) {
    // Пробуем текущую модель
    for (let attempt = 0; attempt < this.modelsToTry.length; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Примерный подсчет токенов (4 символа ≈ 1 токен)
        const tokensUsed = Math.ceil((prompt.length + text.length) / 4);

        console.log(`✅ Успешная генерация с моделью: ${this.modelsToTry[this.currentModelIndex]}`);
        return {
          text,
          tokensUsed,
          success: true
        };
      } catch (error) {
        console.error(`❌ Модель ${this.modelsToTry[this.currentModelIndex]} не работает:`, error.message);

        // Если модель не найдена, квота исчерпана или перегружена, пробуем следующую
        if (error.message.includes('404') || error.message.includes('429') || error.message.includes('503') || error.message.includes('quota') || error.message.includes('overloaded')) {
          this.currentModelIndex++;
          if (this.currentModelIndex < this.modelsToTry.length) {
            console.log(`🔄 Переключаюсь на модель: ${this.modelsToTry[this.currentModelIndex]}`);
            this.model = this.genAI.getGenerativeModel({
              model: this.modelsToTry[this.currentModelIndex]
            });
            continue; // Пробуем следующую модель
          }
        }

        // Если перепробовали все модели или другая ошибка
        throw new Error('Не удалось сгенерировать ответ: ' + error.message);
      }
    }

    throw new Error('Ни одна модель Gemini не доступна для вашего API ключа');
  }

  /**
   * Генерация с учетом истории диалога
   * @param {Array} messages - Массив сообщений [{role: 'user', text: '...'}, ...]
   * @returns {Promise<{text: string, tokensUsed: number}>}
   */
  async generateWithHistory(messages) {
    try {
      const chat = this.model.startChat({
        history: messages.slice(0, -1).map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        })),
        generationConfig: {
          maxOutputTokens: 1000,
        },
      });

      const lastMessage = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMessage.text);
      const response = await result.response;
      const text = response.text();

      // Подсчет токенов
      const totalText = messages.map(m => m.text).join('') + text;
      const tokensUsed = Math.ceil(totalText.length / 4);

      return {
        text,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('❌ Ошибка Gemini API (история):', error.message);
      throw new Error('Не удалось сгенерировать ответ: ' + error.message);
    }
  }
}

module.exports = GeminiService;

