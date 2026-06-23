import dotenv from 'dotenv';
dotenv.config();

const cleanEnvVar = (val: string | undefined): string => {
  if (!val) return '';
  let clean = val.trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1);
  }
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.slice(1, -1);
  }
  return clean.trim();
};

export const config = {
  telegramBotToken: cleanEnvVar(process.env.TELEGRAM_BOT_TOKEN),
  telegramAllowedUserIds: cleanEnvVar(process.env.TELEGRAM_ALLOWED_USER_IDS).split(',').map(id => id.trim()),
  geminiApiKey: cleanEnvVar(process.env.GEMINI_API_KEY),
  openRouterApiKey: cleanEnvVar(process.env.OPENROUTER_API_KEY),
  openRouterModel: cleanEnvVar(process.env.OPENROUTER_MODEL) || 'openrouter/free',
  groqApiKey: cleanEnvVar(process.env.GROQ_API_KEY),
  groqModel: cleanEnvVar(process.env.GROQ_MODEL) || 'llama-3.3-70b-versatile',
  postgrestUrl: cleanEnvVar(process.env.POSTGREST_URL) || 'http://localhost:3000',
  postgrestAnonKey: cleanEnvVar(process.env.POSTGREST_ANON_KEY),
  tavilyApiKey: cleanEnvVar(process.env.TAVILY_API_KEY),
  projectsRootPath: cleanEnvVar(process.env.PROJECTS_ROOT_PATH) || 'projects',
  codingAgentApiKey: cleanEnvVar(process.env.CODING_AGENT_API_KEY),
  proxmoxHost: cleanEnvVar(process.env.PROXMOX_HOST) || '192.168.1.254',
  enableProxmoxControl: cleanEnvVar(process.env.ENABLE_PROXMOX_CONTROL) === 'true',
  // 🌉 Puente Zeepub-bot (MCP)
  zeepubApiUrl: cleanEnvVar(process.env.ZEEPUB_API_URL) || 'http://localhost:8000',
  zeepubApiKey: cleanEnvVar(process.env.ZEEPUB_API_KEY),
  // 🌐 Webhooks opcionales para producción
  webhookUrl: cleanEnvVar(process.env.WEBHOOK_URL),
  port: parseInt(cleanEnvVar(process.env.PORT) || '8080'),
};

// Validar reglas críticas de env
if (!config.telegramBotToken) throw new Error('falta TELEGRAM_BOT_TOKEN en .env');
if (config.telegramAllowedUserIds.length === 0 || config.telegramAllowedUserIds[0] === '') {
  throw new Error('falta TELEGRAM_ALLOWED_USER_IDS en .env');
}
if (!config.geminiApiKey) throw new Error('falta GEMINI_API_KEY en .env');
if (!config.postgrestUrl) throw new Error('falta POSTGREST_URL en .env');
