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
      let parsedJson: any = null;
      try {
        const trimmed = stdout.trim();
        const lastCurly = trimmed.lastIndexOf('}');
        const firstCurly = trimmed.lastIndexOf('{', lastCurly);
        if (firstCurly !== -1 && lastCurly !== -1) {
          const jsonCandidate = trimmed.substring(firstCurly, lastCurly + 1);
          parsedJson = JSON.parse(jsonCandidate);
        } else if (trimmed) {
          parsedJson = JSON.parse(trimmed);
        }
      } catch (e) {
        // Ignorar si no es JSON válido
      }

      if (parsedJson && parsedJson.success === false) {
        reject(new Error(parsedJson.error || 'Error desconocido del procesador de medios'));
      } else if (code !== 0) {
        const maxStderrLen = 3000;
        const truncatedStderr = stderr.length > maxStderrLen 
          ? stderr.substring(0, maxStderrLen) + '\n[Stderr truncado...]' 
          : stderr;
        reject(new Error(`Python process exited with code ${code}. Stderr: ${truncatedStderr}`));
      } else {
        if (parsedJson) {
          resolve(parsedJson);
        } else {
          reject(new Error(`Failed to parse Python output as JSON: ${stdout}`));
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
      const artworkStatus = metadata.artwork_path ? "✅ HD Lista" : "❌ No encontrada";
      const fileExt = metadata.filepath?.split('.').pop()?.toUpperCase() || 'M4A';
      const formatLabel = fileExt === 'M4A' ? 'M4A Nativo' : fileExt;
      const replyText = `🎵 <b>Análisis de Pista Exitoso (${formatLabel})</b>\n` +
        `👤 <b>Artista:</b> ${metadata.artist}\n` +
        `💿 <b>Track:</b> ${metadata.title}\n` +
        `📀 <b>Álbum:</b> ${metadata.album}\n` +
        `🖼️ <b>Carátula:</b> ${artworkStatus}\n` +
        `📝 <b>Letras:</b> ${lyricsStatus}\n\n` +
        `🧠 <b>Carpeta Destino Sugerida:</b> <code>${metadata.genre}</code>\n\n` +
        `Por favor selecciona una categoría para archivar en tu servidor:`;

      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, replyText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
    } catch (e: any) {
      console.error(`[MediaProcessor Error]`, e);
      const safeErrorMsg = `❌ Error al procesar el audio: ${e.message}`.substring(0, 3500);
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, safeErrorMsg);
    }
  });

  // =========================================================================
  // COMANDO /fix - Escanear y corregir archivos locales del servidor
  // =========================================================================
  bot.command('fix', isAdminMiddleware, async (ctx) => {
    const localPath = ctx.match.trim();
    if (!localPath) {
      return await ctx.reply(
        "💡 <b>Uso:</b> <code>/fix /ruta/al/archivo.mp3</code>\n" +
        "Escanea un archivo local y le inyecta metadatos, letras y carátula.",
        { parse_mode: 'HTML' }
      );
    }

    const taskId = `fix_${ctx.message?.message_id}`;
    if (!taskId) return;

    const msg = await ctx.reply(
      "🔍 Analizando archivo local y consultando bases de datos...",
      { message_thread_id: ctx.message?.message_thread_id }
    );

    try {
      const result = await runMediaProcessor(['fix', localPath, taskId]);
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
      const artworkStatus = metadata.artwork_path ? "✅ HD Lista" : "❌ No encontrada";
      const fileExt = localPath.split('.').pop()?.toUpperCase() || '???';

      const replyText = `🛠️ <b>Corrección de Archivo Local</b>\n` +
        `📝 <b>Ruta:</b> <code>${localPath}</code>\n` +
        `🎧 <b>Formato:</b> ${fileExt}\n\n` +
        `👤 <b>Artista Encontrado:</b> ${metadata.artist}\n` +
        `💿 <b>Track Encontrado:</b> ${metadata.title}\n` +
        `📀 <b>Álbum:</b> ${metadata.album}\n` +
        `🖼️ <b>Carátula:</b> ${artworkStatus}\n` +
        `📝 <b>Letras:</b> ${lyricsStatus}\n\n` +
        `🧠 <b>Destino sugerido:</b> <code>${metadata.genre}</code>\n\n` +
        `Selecciona el destino para corregir etiquetas y mover dentro de Navidrome.`;

      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, replyText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
    } catch (e: any) {
      console.error(`[MediaProcessor Fix Error]`, e);
      const safeErrorMsg = `❌ Error al escanear archivo: ${e.message}`.substring(0, 3500);
      await ctx.api.editMessageText(
        ctx.chat.id, msg.message_id,
        safeErrorMsg
      );
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
      const safeErrorMsg = `❌ Ocurrió un error escribiendo en el almacenamiento: ${e.message}`.substring(0, 3500);
      await ctx.editMessageText(safeErrorMsg);
    }
  });
}
