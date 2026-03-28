import { bot, initializeBot } from './bot/index.js';

const start = async () => {
  console.log('[System] SP-Agent starting up...');
  
  // Initialize bot settings and commands
  await initializeBot();
  
  // Start the bot with long polling
  bot.start({
    onStart: (botInfo) => {
      console.log(`[Telegram] Bot started as @${botInfo.username}`);
    }
  });

  // Handle graceful shutdown
  process.once('SIGINT', () => {
    bot.stop();
    console.log('[System] Shutting down gracefully.');
  });
  process.once('SIGTERM', () => {
    bot.stop();
    console.log('[System] Shutting down gracefully.');
  });
};

start().catch(console.error);
