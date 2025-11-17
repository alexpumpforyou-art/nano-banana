const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Используем актуальную модель gemini-1.5-flash
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  /**
   * Генерация текста через Gemini API
   * @param {string} prompt - Текст запроса
   * @returns {Promise<{text: string, tokensUsed: number}>}
   */
  async generate(prompt) {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Примерный подсчет токенов (4 символа ≈ 1 токен)
      const tokensUsed = Math.ceil((prompt.length + text.length) / 4);

      return {
        text,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('❌ Ошибка Gemini API:', error.message);
      throw new Error('Не удалось сгенерировать ответ: ' + error.message);
    }
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

