import dotenv from 'dotenv';
dotenv.config();

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramAllowedUserIds: (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(id => id.trim()),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openRouterModel: process.env.OPENROUTER_MODEL || 'openrouter/free',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  postgrestUrl: process.env.POSTGREST_URL || 'http://localhost:3000',
  postgrestAnonKey: process.env.POSTGREST_ANON_KEY || '',
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  projectsRootPath: process.env.PROJECTS_ROOT_PATH || 'projects',
  codingAgentApiKey: process.env.CODING_AGENT_API_KEY || '',
  // 🌉 Puente Zeepub-bot (MCP)
  zeepubApiUrl: process.env.ZEEPUB_API_URL || 'http://localhost:8000',
  zeepubApiKey: process.env.ZEEPUB_API_KEY || '',
};

// Validar reglas críticas de env
if (!config.telegramBotToken) throw new Error('falta TELEGRAM_BOT_TOKEN en .env');
if (config.telegramAllowedUserIds.length === 0 || config.telegramAllowedUserIds[0] === '') {
  throw new Error('falta TELEGRAM_ALLOWED_USER_IDS en .env');
}
if (!config.geminiApiKey) throw new Error('falta GEMINI_API_KEY en .env');
if (!config.postgrestUrl) throw new Error('falta POSTGREST_URL en .env');
