import { bot, initializeBot } from './bot/index.js';

const start = async () => {
  console.log('[System] SP-Agent starting up...');
  
  // Initialize bot settings and commands
  await initializeBot();
  
  // Iniciar el bot (Webhooks o Long Polling)
  const { config } = await import('./config.js');
  if (config.webhookUrl) {
    const { createServer } = await import('http');
    const { webhookCallback } = await import('grammy');
    const handleMainBot = webhookCallback(bot, 'http');

    const server = createServer(async (req, res) => {
      // Rutear actualizaciones a bots gestionados (/bot/<token>)
      const match = req.url?.match(/^\/bot\/([\w:-]+)$/);
      if (match) {
        const token = match[1];
        const { ManagedBotService } = await import('./bot/manager.js');
        const subBot = ManagedBotService.getBotByToken(token);
        if (subBot) {
          return webhookCallback(subBot, 'http')(req, res);
        }
      }

      // Rutear actualización al bot principal (/main o /)
      if (req.url === '/' || req.url === '/main') {
        return handleMainBot(req, res);
      }

      res.statusCode = 404;
      res.end('Not Found');
    });

    // Registrar el webhook del bot principal en Telegram
    const mainWebhookPath = `${config.webhookUrl}/main`;
    await bot.api.setWebhook(mainWebhookPath);
    console.log(`[Telegram] 🌐 Webhook principal registrado: ${mainWebhookPath}`);

    server.listen(config.port, () => {
      console.log(`[Telegram] 🚀 Servidor HTTP de Webhooks activo en el puerto ${config.port}`);
    });
  } else {
    // Iniciar con Long Polling (desarrollo / local)
    bot.start({
      onStart: (botInfo) => {
        console.log(`[Telegram] 🚀 Bot iniciado en modo Long Polling como @${botInfo.username}`);
      }
    });
  }

  // Manejar apagado ordenado
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
