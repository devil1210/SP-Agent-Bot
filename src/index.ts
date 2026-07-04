import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { bot, initializeBot } from './bot/index.js';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { apiRouter } from './bot/api.js';

const start = async () => {
  console.log('[System] SP-Agent starting up...');
  
  // Initialize bot settings and commands
  await initializeBot();
  
  const app = express();
  app.use(express.json());

  // Servir archivos estáticos de la Mini App (carpeta /public)
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Registrar las rutas de API
  app.use('/api', apiRouter);

  // Manejar webhook del bot principal si está configurado
  let handleMainBot: any = null;
  if (config.webhookUrl) {
    handleMainBot = webhookCallback(bot, 'express');
  }

  // Rutear actualizaciones a bots gestionados (/bot/<token>)
  app.post('/bot/:token', async (req: Request, res: Response, next: NextFunction) => {
    const token = req.params.token;
    const { ManagedBotService } = await import('./bot/manager.js');
    const subBot = ManagedBotService.getBotByToken(token);
    if (subBot) {
      return webhookCallback(subBot, 'express')(req, res);
    }
    res.status(404).send('Not Found');
  });

  // Rutear actualización al bot principal (/main o /)
  app.post(['/', '/main'], (req: Request, res: Response, next: NextFunction) => {
    if (handleMainBot) {
      handleMainBot(req, res);
    } else {
      res.status(501).send('Webhook not configured (running in long polling mode)');
    }
  });

  // Fallback para index.html (SPA routing)
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  });

  // Iniciar el servidor Express
  app.listen(config.port, async () => {
    console.log(`[System] 🚀 Servidor Express activo en el puerto ${config.port}`);
    
    if (config.webhookUrl) {
      const mainWebhookPath = `${config.webhookUrl}/main`;
      await bot.api.setWebhook(mainWebhookPath);
      console.log(`[Telegram] 🌐 Webhook principal registrado: ${mainWebhookPath}`);
    } else {
      // Iniciar con Long Polling (desarrollo / local)
      bot.start({
        onStart: (botInfo) => {
          console.log(`[Telegram] 🚀 Bot iniciado en modo Long Polling como @${botInfo.username}`);
        }
      });
    }
  });

  // Manejar apagado ordenado
  process.once('SIGINT', () => {
    bot.stop();
    console.log('[System] Shutting down gracefully.');
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    bot.stop();
    console.log('[System] Shutting down gracefully.');
    process.exit(0);
  });
};

start().catch(console.error);
