// Альтернатива: YandexGPT (работает в России без VPN)
// 
// Чтобы переключиться на YandexGPT:
// 1. Получите API ключ: https://cloud.yandex.ru/docs/iam/operations/api-key/create
// 2. Установите: npm install axios
// 3. Замените gemini-service.js этим кодом

const axios = require('axios');

class YandexGPTService {
  constructor(apiKey, folderId) {
    this.apiKey = apiKey;
    this.folderId = folderId;
    this.apiUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
  }

  async generate(prompt) {
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          modelUri: `gpt://${this.folderId}/yandexgpt-lite`,
          completionOptions: {
            stream: false,
            temperature: 0.7,
            maxTokens: 1000
          },
          messages: [
            {
              role: 'user',
              text: prompt
            }
          ]
        },
        {
          headers: {
            'Authorization': `Api-Key ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const text = response.data.result.alternatives[0].message.text;
      const tokensUsed = Math.ceil((prompt.length + text.length) / 4);

      return {
        text,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('❌ Ошибка YandexGPT API:', error.message);
      throw new Error('Не удалось сгенерировать ответ: ' + error.message);
    }
  }
}

module.exports = YandexGPTService;

// В .env добавить:
// YANDEX_API_KEY=ваш_ключ
// YANDEX_FOLDER_ID=ваш_folder_id

