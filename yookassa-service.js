const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class YookassaService {
    constructor(shopId, secretKey) {
        this.shopId = shopId;
        this.secretKey = secretKey;
        this.baseUrl = 'https://api.yookassa.ru/v3';
    }

    /**
     * Создание платежа
     * @param {number} amount Сумма платежа
     * @param {string} description Описание платежа
     * @param {string} returnUrl Ссылка для возврата после оплаты
     * @param {object} metadata Метаданные (например, userId)
     * @returns {Promise<object>} Объект платежа
     */
    async createPayment(amount, description, returnUrl, metadata = {}) {
        try {
            const idempotenceKey = uuidv4();
            const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');

            const response = await axios.post(
                `${this.baseUrl}/payments`,
                {
                    amount: {
                        value: amount.toFixed(2),
                        currency: 'RUB'
                    },
                    capture: true,
                    confirmation: {
                        type: 'redirect',
                        return_url: returnUrl
                    },
                    description: description,
                    metadata: metadata,
                    receipt: metadata.email ? {
                        customer: {
                            email: metadata.email
                        },
                        items: [
                            {
                                description: description,
                                quantity: '1.00',
                                amount: {
                                    value: amount.toFixed(2),
                                    currency: 'RUB'
                                },
                                vat_code: 1 // Без НДС (или укажите нужный код)
                            }
                        ]
                    } : undefined
                },
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Idempotence-Key': idempotenceKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('YooKassa createPayment error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Получение информации о платеже
     * @param {string} paymentId ID платежа
     * @returns {Promise<object>} Объект платежа
     */
    async getPayment(paymentId) {
        try {
            const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');

            const response = await axios.get(
                `${this.baseUrl}/payments/${paymentId}`,
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('YooKassa getPayment error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = YookassaService;
