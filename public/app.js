// API Base URL
const API_URL = window.location.origin;

// State
let webId = localStorage.getItem('nano_banana_web_id');
let userTokens = 0;
let totalGenerations = 0;
let totalTokensUsed = 0;

// DOM Elements
const promptInput = document.getElementById('prompt');
const generateBtn = document.getElementById('generateBtn');
const messagesDiv = document.getElementById('messages');
const balanceEl = document.getElementById('balance');
const loadingEl = document.getElementById('loading');
const totalGenerationsEl = document.getElementById('total-generations');
const tokensUsedEl = document.getElementById('tokens-used');
const welcomeBalanceEl = document.getElementById('welcome-balance');

// Initialize
async function init() {
    try {
        const response = await fetch(`${API_URL}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webId })
        });

        const data = await response.json();

        if (data.success) {
            webId = data.user.webId;
            userTokens = data.user.tokens;
            localStorage.setItem('nano_banana_web_id', webId);
            updateBalance();
            welcomeBalanceEl.textContent = userTokens;
            loadHistory();
        }
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showMessage('assistant', '❌ Ошибка подключения к серверу. Попробуйте обновить страницу.');
    }
}

// Update Balance
function updateBalance() {
    balanceEl.textContent = userTokens;
    
    if (userTokens <= 0) {
        balanceEl.style.color = 'var(--secondary)';
    } else if (userTokens < 100) {
        balanceEl.style.color = 'var(--warning)';
    } else {
        balanceEl.style.color = 'var(--dark)';
    }
}

// Show Message
function showMessage(type, text, tokensUsed = null) {
    // Remove welcome message if exists
    const welcomeMsg = document.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;

    messageDiv.appendChild(contentDiv);

    if (tokensUsed !== null) {
        const footerDiv = document.createElement('div');
        footerDiv.className = 'message-footer';
        footerDiv.textContent = `Токенов использовано: ${tokensUsed}`;
        messageDiv.appendChild(footerDiv);
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Generate Response
async function generate() {
    const prompt = promptInput.value.trim();

    if (!prompt) {
        alert('Пожалуйста, введите запрос');
        return;
    }

    if (userTokens <= 0) {
        showMessage('assistant', '❌ У вас недостаточно токенов! Используйте Telegram бота для покупки токенов.');
        return;
    }

    // Disable input
    generateBtn.disabled = true;
    promptInput.disabled = true;
    loadingEl.classList.add('active');

    // Show user message
    showMessage('user', prompt);

    try {
        const response = await fetch(`${API_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webId, prompt })
        });

        const data = await response.json();

        if (data.success) {
            showMessage('assistant', data.response, data.tokensUsed);
            userTokens = data.tokensRemaining;
            updateBalance();
            
            totalGenerations++;
            totalTokensUsed += data.tokensUsed;
            updateStats();

            promptInput.value = '';
        } else {
            if (data.needTokens) {
                showMessage('assistant', `❌ ${data.error}\n\n💡 Используйте наш Telegram бот для покупки токенов!`);
            } else {
                showMessage('assistant', `❌ Ошибка: ${data.error}`);
            }
        }
    } catch (error) {
        console.error('Ошибка генерации:', error);
        showMessage('assistant', '❌ Произошла ошибка при генерации. Попробуйте еще раз.');
    } finally {
        generateBtn.disabled = false;
        promptInput.disabled = false;
        loadingEl.classList.remove('active');
    }
}

// Update Stats
function updateStats() {
    totalGenerationsEl.textContent = totalGenerations;
    tokensUsedEl.textContent = totalTokensUsed;
}

// Load History
async function loadHistory() {
    try {
        const response = await fetch(`${API_URL}/api/history/${webId}?limit=50`);
        const data = await response.json();

        if (data.success && data.history.length > 0) {
            totalGenerations = data.history.length;
            totalTokensUsed = data.history.reduce((sum, item) => sum + item.tokens_used, 0);
            updateStats();
        }
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
    }
}

// Event Listeners
generateBtn.addEventListener('click', generate);

promptInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generate();
    }
});

// Example buttons
document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        promptInput.value = btn.dataset.prompt;
        promptInput.focus();
    });
});

// Initialize on load
init();

