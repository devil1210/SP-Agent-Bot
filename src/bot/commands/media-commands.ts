import { Bot, Context, InlineKeyboard } from 'grammy';
import { spawn } from 'child_process';
import { isAdmin } from '../helpers.js';

const pendingTasks = new Map<string, any>();

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

function runMediaProcessor(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    console.log(`[MediaProcessor] Spawning: ${pythonCmd} scripts/media_processor.py ${args.join(' ')}`);
    const proc = spawn(pythonCmd, ['scripts/media_processor.py', ...args]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}. Stderr: ${stderr}`));
      } else {
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse Python output as JSON: ${stdout}. Error: ${e}`));
        }
      }
    });
  });
}

const GENRE_MAPPING_KEYS = [
  "J-Music",
  "Música-Cumbias-y-Tropical",
  "Música-Rancheras",
  "Música-Reggaeton",
  "Música-Rock",
  "Música-HipHop",
  "Música-Electronica",
  "Música-Pop"
];

export function registerMediaCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  bot.command('playlist', isAdminMiddleware, async (ctx) => {
    const url = ctx.match.trim();
    if (!url) {
      return await ctx.reply("💡 <b>Uso:</b> <code>/playlist &lt;URL_YOUTUBE&gt;</code>", { parse_mode: 'HTML' });
    }

    const taskId = ctx.message?.message_id.toString();
    if (!taskId) return;

    const msg = await ctx.reply("⏳ Descargando pista, procesando Romaji y cruzando tiendas digitales...", {
      message_thread_id: ctx.message?.message_thread_id
    });

    try {
      const result = await runMediaProcessor(['download', url, taskId]);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      const metadata = result.metadata;
      pendingTasks.set(taskId, metadata);

      // Build keyboard
      const keyboard = new InlineKeyboard();
      keyboard.text(`✅ Confirmar sugerido: ${metadata.genre}`, `confirm_${taskId}`).row();
      for (const genreKey of GENRE_MAPPING_KEYS) {
        keyboard.text(`📁 ${genreKey}`, `set_${taskId}_${genreKey}`).row();
      }

      const lyricsStatus = metadata.lyrics ? "✅ Localizada" : "❌ No encontrada";
      const replyText = `🎵 <b>Análisis de Pista Exitoso</b>\n` +
        `👤 <b>Artista:</b> ${metadata.artist}\n` +
        `💿 <b>Track:</b> ${metadata.title}\n` +
        `📀 <b>Álbum:</b> ${metadata.album}\n` +
        `📝 <b>Letras:</b> ${lyricsStatus}\n\n` +
        `🧠 <b>Carpeta Destino Sugerida:</b> <code>${metadata.genre}</code>\n\n` +
        `Por favor selecciona una categoría para archivar en tu servidor:`;

      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, replyText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
    } catch (e: any) {
      console.error(`[MediaProcessor Error]`, e);
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `❌ Error al procesar el audio: ${e.message}`);
    }
  });

  bot.callbackQuery(/^(confirm|set)_(.+)$/, async (ctx) => {
    const match = ctx.match;
    if (!match) return;

    const action = match[1];
    const rest = match[2];

    let taskId: string;
    let selectedGenre: string | undefined = undefined;

    if (action === "confirm") {
      taskId = rest;
    } else {
      // action === "set" -> rest is taskId_genre
      const underscoreIndex = rest.indexOf('_');
      if (underscoreIndex === -1) return;
      taskId = rest.substring(0, underscoreIndex);
      selectedGenre = rest.substring(underscoreIndex + 1);
    }

    const metadata = pendingTasks.get(taskId);
    if (!metadata) {
      await ctx.answerCallbackQuery({ text: "Esta tarea ya fue procesada o expiró.", show_alert: true });
      return;
    }

    if (selectedGenre) {
      metadata.genre = selectedGenre;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText("⚙️ Escribiendo tags ID3, inyectando letra y enviando a Navidrome...");

    try {
      const result = await runMediaProcessor(['finalize', metadata.filepath, JSON.stringify(metadata)]);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      pendingTasks.delete(taskId);
      await ctx.editMessageText(`✅ <b>Operación Exitosa</b>\nOrganizado correctamente en:\n<code>${result.final_path}</code>`, {
        parse_mode: 'HTML'
      });
    } catch (e: any) {
      console.error(`[MediaProcessor Error]`, e);
      await ctx.editMessageText(`❌ Ocurrió un error escribiendo en el almacenamiento: ${e.message}`);
    }
  });
}
