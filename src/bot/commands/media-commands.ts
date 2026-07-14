import { Bot, Context, InlineKeyboard } from 'grammy';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { isAdmin } from '../helpers.js';
import { config } from '../../config.js';

export const pendingTasks = new Map<string, any>();

// TTL de 10 minutos para evitar fuga de memoria si el usuario no confirma (Bug #8)
const TASK_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, task] of pendingTasks.entries()) {
        if (task._created && now - task._created > TASK_TTL_MS) {
            pendingTasks.delete(id);
        }
    }
}, 60_000);

function storeTask(taskId: string, data: Record<string, any>): void {
    pendingTasks.set(taskId, { ...data, _created: Date.now() });
}

// Patrón de validación de URLs de YouTube / YouTube Music
const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i;

// Cola de descargas: máximo 2 descargas pesadas en paralelo
const MAX_CONCURRENT_DOWNLOADS = 2;
let activeDownloads = 0;
const downloadQueue: Array<() => void> = [];

function withDownloadQueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = async () => {
            activeDownloads++;
            try {
                resolve(await fn());
            } catch (e) {
                reject(e);
            } finally {
                activeDownloads--;
                if (downloadQueue.length > 0) {
                    downloadQueue.shift()!();
                }
            }
        };
        if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
            run();
        } else {
            downloadQueue.push(run);
        }
    });
}

let pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
if (process.platform === 'win32' && existsSync(join(process.cwd(), 'venv', 'Scripts', 'python.exe'))) {
  pythonCmd = join(process.cwd(), 'venv', 'Scripts', 'python.exe');
} else if (process.platform !== 'win32' && existsSync(join(process.cwd(), 'venv', 'bin', 'python3'))) {
  pythonCmd = join(process.cwd(), 'venv', 'bin', 'python3');
} else if (process.platform !== 'win32' && existsSync(join(process.cwd(), 'venv', 'bin', 'python'))) {
  pythonCmd = join(process.cwd(), 'venv', 'bin', 'python');
}

export function runMediaProcessor(args: string[]): Promise<any> {
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
        // Find the last '}' and walk backwards to find its matching '{'
        const lastCurly = trimmed.lastIndexOf('}');
        if (lastCurly !== -1) {
          let depth = 0;
          let startIdx = -1;
          for (let i = lastCurly; i >= 0; i--) {
            if (trimmed[i] === '}') depth++;
            else if (trimmed[i] === '{') depth--;
            if (depth === 0) { startIdx = i; break; }
          }
          if (startIdx !== -1) {
            parsedJson = JSON.parse(trimmed.substring(startIdx, lastCurly + 1));
          }
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
  "Cumbias-y-Tropical",
  "Rancheras",
  "Reggaeton",
  "Rock",
  "Rock-Latino",
  "HipHop",
  "Electronica",
  "Pop"
];

export function registerMediaCommands(bot: Bot) {
  const isAdminMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    if (await isAdmin(ctx.from?.id.toString())) {
      await next();
    }
  };

  async function handleMediaDownload(ctx: Context, forceType: 'album' | 'playlist') {
    if (!ctx.chat) return;
    const matchStr = typeof ctx.match === 'string' ? ctx.match : (Array.isArray(ctx.match) ? ctx.match[0] : '');
    const url = (matchStr || "").trim();
    if (!url) {
      return await ctx.reply(`💡 <b>Uso:</b> <code>/${forceType} &lt;URL_YOUTUBE&gt;</code>`, { parse_mode: 'HTML' });
    }
    if (!YOUTUBE_URL_RE.test(url)) {
      return await ctx.reply(
        `❌ <b>URL no válida.</b>\nDebe ser un enlace de YouTube o YouTube Music (youtube.com, youtu.be, music.youtube.com).`,
        { parse_mode: 'HTML' }
      );
    }

    // taskId incluye el chatId para evitar colisión entre distintos usuarios
    const taskId = `${ctx.chat!.id}_${ctx.message?.message_id}`;
    if (!taskId) return;

    const msg = await ctx.reply("⏳ Descargando pista, procesando Romaji y cruzando tiendas digitales...", {
      message_thread_id: ctx.message?.message_thread_id
    });

    // Encolar la descarga si hay demasiadas en paralelo
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      await ctx.api.editMessageText(
        ctx.chat!.id, msg.message_id,
        `🕐 <b>En cola...</b> Hay ${activeDownloads} descarga(s) activa(s). Tu pedido se procesará en breve.`,
        { parse_mode: 'HTML' }
      );
    }

    try {
      const result = await withDownloadQueue(() => runMediaProcessor(['download', url, taskId, forceType || 'auto']));
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Caso: Múltiples candidatos encontrados en MusicBrainz para un álbum
      if (result.candidates && result.candidates.length > 0) {
        storeTask(taskId, { url, forceType, candidates: result.candidates, playlist_title: result.playlist_title, playlist_artist: result.playlist_artist, msg_id: msg.message_id });
        
        let candidatesText = `🔍 <b>Múltiples coincidencias en MusicBrainz</b>\n` +
          `Se encontraron varios candidatos para el álbum <b>${result.playlist_title}</b> de <b>${result.playlist_artist}</b>:\n\n`;
          
        const keyboard = new InlineKeyboard();
        const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
        
        result.candidates.forEach((c: any, index: number) => {
          const emoji = numberEmojis[index] || `${index + 1}.`;
          const yearLabel = c.year ? ` (${c.year})` : '';
          const tracksLabel = c.tracks ? ` - ${c.tracks} pistas` : '';
          const countryLabel = c.country ? ` [${c.country}]` : '';
          
          candidatesText += `${emoji} <a href="https://musicbrainz.org/release/${c.id}">${c.title}</a>${yearLabel}${tracksLabel}${countryLabel} por ${c.artist}\n`;
          
          keyboard.text(`💿 Opción ${index + 1}`, `selrel_${taskId}_${index}`);
          if ((index + 1) % 2 === 0) keyboard.row();
        });
        
        if (result.candidates.length % 2 !== 0) keyboard.row();
        keyboard.text("🚫 Usar metadatos originales de YouTube Music", `selrel_${taskId}_none`).row();

        await ctx.api.editMessageText(
          ctx.chat!.id,
          msg.message_id,
          candidatesText + `\nPor favor selecciona la opción correcta usando los botones, o decide ignorar la búsqueda si prefieres los datos de YT Music:`,
          { reply_markup: keyboard, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
        return;
      }

      // Caso: El álbum o pista ya existe completo en la biblioteca
      if (result.album_exists) {
        const itemType = result.is_playlist ? 'El álbum' : 'La pista';
        const itemTitle = result.is_playlist ? result.playlist_title : (result.metadata?.title || result.title);
        const itemArtist = result.is_playlist ? result.playlist_artist : (result.metadata?.artist || result.artist);
        await ctx.api.editMessageText(
          ctx.chat!.id,
          msg.message_id,
          `ℹ️ <b>Ya existe en tu biblioteca:</b>\n${itemType} <b>${itemTitle}</b> de <b>${itemArtist}</b> ya se encuentra completo en tu servidor.\n\n📂 <b>Ruta:</b> <code>${result.existing_path}</code>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Caso: Es una playlist personalizada y todas las canciones ya existen
      if (result.playlist_exists_completely) {
        result.is_album_mode = false;
        storeTask(taskId, result);

        const keyboard = new InlineKeyboard();
        keyboard.text("✅ Crear playlist en Navidrome", `confirm_${taskId}`).row();

        await ctx.api.editMessageText(
          ctx.chat!.id,
          msg.message_id,
          `ℹ️ <b>Todas las canciones ya existen:</b>\nTodas las canciones de la playlist <b>${result.playlist_title}</b> ya están en tu biblioteca.\n\n¿Deseas crear el archivo de playlist (.m3u) para Navidrome con estas canciones en su orden original?`,
          { reply_markup: keyboard, parse_mode: 'HTML' }
        );
        return;
      }

      if (result.is_playlist) {
        result.is_album_mode = forceType === 'album';
        storeTask(taskId, result);

        const totalTracks = result.tracks.length;
        const existingTracks = result.tracks.filter((t: any) => t.already_exists).length;
        const newTracks = totalTracks - existingTracks;
        const dupLabel = existingTracks > 0 
          ? ` (${newTracks} nuevas, ${existingTracks} ya en biblioteca)` 
          : '';

        // Si es playlist personalizada, mostrar prompt de AcoustID antes del selector de género (Spec §1.B)
        if (result.is_custom_playlist) {
          const keyboard = new InlineKeyboard();
          keyboard.text('🎵 Sí, usar AcoustID', `acoustid_${taskId}_yes`).row();
          keyboard.text('🚀 No, usar metadatos de YouTube', `acoustid_${taskId}_no`).row();

          await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            `🔀 <b>Playlist personalizada detectada</b>\n` +
            `📦 <b>Total de Pistas:</b> ${totalTracks} canciones${dupLabel}\n\n` +
            `¿Deseas identificar canciones por huella de audio (<b>AcoustID/MusicID</b>)?\n` +
            `Si los metadatos de YouTube Music son poco fiables, esto puede mejorar significativamente los tags.`,
            { reply_markup: keyboard, parse_mode: 'HTML' }
          );
          return;
        }

        // Build keyboard
        const keyboard = new InlineKeyboard();
        const modeLabel = result.is_album_mode ? "📀 Modo: Álbum (Homogéneo)" : "🔀 Modo: Mix (Pistas Sueltas)";
        keyboard.text(modeLabel, `togglealbum_${taskId}`).row();
        keyboard.text(`✅ Confirmar sugerido: ${result.genre}`, `confirm_${taskId}`).row();
        for (const genreKey of GENRE_MAPPING_KEYS) {
          keyboard.text(`📁 ${genreKey}`, `set_${taskId}_${genreKey}`).row();
        }

        const modeDesc = result.is_album_mode 
          ? "Se unificarán los temas bajo el mismo artista, año y carátula del álbum." 
          : "Se respetará el artista, álbum, año y carátula individual de cada pista.";

        const replyText = `🎵 <b>Análisis de Álbum/Playlist Exitoso</b>\n` +
          `💿 <b>Álbum/Playlist:</b> ${result.playlist_title}\n` +
          `👤 <b>Artista/Canal:</b> ${result.playlist_artist}\n` +
          `📦 <b>Total de Pistas:</b> ${totalTracks} canciones${dupLabel}\n` +
          `🖼️ <b>Carátulas:</b> ${result.tracks_with_artwork || 0}/${totalTracks} listas\n` +
          `📝 <b>Letras:</b> ${result.tracks_with_lyrics || 0}/${totalTracks} localizadas\n` +
          `⚙️ <b>Modo Seleccionado:</b> <b>${result.is_album_mode ? "Álbum" : "Mix / Playlist"}</b>\n` +
          `💡 <i>${modeDesc}</i>\n\n` +
          `🧠 <b>Carpeta Destino Sugerida:</b> <code>${result.genre}</code>\n\n` +
          `Por favor selecciona una categoría para archivar todas las canciones en tu servidor:`;

        await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, replyText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        const metadata = result.metadata;
        storeTask(taskId, metadata);

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
      }
    } catch (e: any) {
      console.error(`[MediaProcessor Error]`, e);
      const safeErrorMsg = `❌ Error al procesar el audio: ${e.message}`.substring(0, 3500);
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, safeErrorMsg);
    }
  }

  bot.command('playlist', isAdminMiddleware, async (ctx) => {
    await handleMediaDownload(ctx, 'playlist');
  });

  bot.command('album', isAdminMiddleware, async (ctx) => {
    await handleMediaDownload(ctx, 'album');
  });

  bot.command('romanize', isAdminMiddleware, async (ctx) => {
    const localPath = ctx.match.trim();
    if (!localPath) {
      return await ctx.reply(
        "💡 <b>Uso:</b> <code>/romanize /ruta/a/la/carpeta</code>\n" +
        "Romaniza recursivamente nombres de archivos, carpetas y metadatos de audio (Kanji/Kana -> Romaji).",
        { parse_mode: 'HTML' }
      );
    }

    const msg = await ctx.reply(
      "⏳ Iniciando romanización recursiva de archivos, carpetas y tags en el servidor...",
      { message_thread_id: ctx.message?.message_thread_id }
    );

    try {
      const proc = spawn(pythonCmd, ['romanizer.py', localPath]);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        if (code !== 0) {
          const errMsg = (stderr || stdout).substring(0, 3000);
          await ctx.api.editMessageText(
            ctx.chat!.id, msg.message_id,
            `❌ <b>Error al romanizar (código ${code}):</b>\n<pre>${errMsg}</pre>`,
            { parse_mode: 'HTML' }
          );
        } else {
          const lines = stdout.split('\n').filter(l => l.trim().startsWith('[Archivo]') || l.trim().startsWith('[Carpeta]'));
          const summary = lines.slice(0, 20).join('\n');
          const remaining = lines.length > 20 ? `\n... y ${lines.length - 20} elementos más.` : '';
          
          await ctx.api.editMessageText(
            ctx.chat!.id, msg.message_id,
            `✅ <b>Romanización completada con éxito</b>\n\n` +
            `<pre>${summary || "No se requirieron cambios (los archivos ya estaban en Romaji o no contienen japonés)."}${remaining}</pre>`,
            { parse_mode: 'HTML' }
          );
        }
      });
    } catch (e: any) {
      console.error(`[Romanizer Command Error]`, e);
      await ctx.api.editMessageText(
        ctx.chat!.id, msg.message_id,
        `❌ Error al iniciar el romanizador: ${e.message}`
      );
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

    // taskId incluye chatId para evitar colisión entre usuarios
    const taskId = `fix_${ctx.chat!.id}_${ctx.message?.message_id}`;
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
      storeTask(taskId, metadata);

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
        ctx.chat!.id, msg.message_id,
        safeErrorMsg
      );
    }
  });

  bot.callbackQuery(/^selrel_(.+)_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const option = ctx.match[2]; // index or 'none'

    const task = pendingTasks.get(taskId);
    if (!task) {
      await ctx.answerCallbackQuery({ text: "Esta tarea expiró o no existe.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText("⏳ Aplicando selección y procesando metadatos finales...");

    let chosenReleaseId = 'none';
    if (option !== 'none') {
      const idx = parseInt(option);
      chosenReleaseId = task.candidates[idx].id;
    }

    try {
      // Correr el media processor con el release ID elegido
      const result = await runMediaProcessor(['download', task.url, taskId, task.forceType, chosenReleaseId]);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      if (result.is_playlist) {
        result.is_album_mode = task.forceType === 'album';
        storeTask(taskId, result);

        const totalTracks = result.tracks.length;
        const existingTracks = result.tracks.filter((t: any) => t.already_exists).length;
        const newTracks = totalTracks - existingTracks;
        const dupLabel = existingTracks > 0 
          ? ` (${newTracks} nuevas, ${existingTracks} ya en biblioteca)` 
          : '';

        const keyboard = new InlineKeyboard();
        const modeLabel = result.is_album_mode ? "📀 Modo: Álbum (Homogéneo)" : "🔀 Modo: Mix (Pistas Sueltas)";
        keyboard.text(modeLabel, `togglealbum_${taskId}`).row();
        keyboard.text(`✅ Confirmar sugerido: ${result.genre}`, `confirm_${taskId}`).row();
        for (const genreKey of GENRE_MAPPING_KEYS) {
          keyboard.text(`📁 ${genreKey}`, `set_${taskId}_${genreKey}`).row();
        }

        const modeDesc = result.is_album_mode 
          ? "Se unificarán los temas bajo el mismo artista, año y carátula del álbum." 
          : "Se respetará el artista, álbum, año y carátula individual de cada pista.";

        const replyText = `🎵 <b>Análisis de Álbum/Playlist Exitoso</b>\n` +
          `💿 <b>Álbum/Playlist:</b> ${result.playlist_title}\n` +
          `👤 <b>Artista/Canal:</b> ${result.playlist_artist}\n` +
          `📦 <b>Total de Pistas:</b> ${totalTracks} canciones${dupLabel}\n` +
          `🖼️ <b>Carátulas:</b> ${result.tracks_with_artwork || 0}/${totalTracks} listas\n` +
          `📝 <b>Letras:</b> ${result.tracks_with_lyrics || 0}/${totalTracks} localizadas\n` +
          `⚙️ <b>Modo Seleccionado:</b> <b>${result.is_album_mode ? "Álbum" : "Mix / Playlist"}</b>\n` +
          `💡 <i>${modeDesc}</i>\n\n` +
          `🧠 <b>Carpeta Destino Sugerida:</b> <code>${result.genre}</code>\n\n` +
          `Por favor selecciona una categoría para archivar todas las canciones en tu servidor:`;

        await ctx.editMessageText(replyText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (e: any) {
      console.error(`[MediaProcessor Selection Error]`, e);
      await ctx.editMessageText(`❌ Error al procesar selección: ${e.message}`);
    }
  });

  // =========================================================================
  // CALLBACK: Prompt de AcoustID para playlists personalizadas (Spec §1.B)
  // =========================================================================
  bot.callbackQuery(/^acoustid_(.+)_(yes|no)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const choice = ctx.match[2];
    const task = pendingTasks.get(taskId);
    if (!task) {
      await ctx.answerCallbackQuery({ text: 'Esta tarea expiró o no existe.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();

    if (choice === 'yes') {
      await ctx.editMessageText('🎵 Identificando canciones por huella de audio (AcoustID)... esto puede tardar unos minutos.');
      try {
        const result = await runMediaProcessor(['enhance_acoustid', JSON.stringify(task)]);
        if (!result.success) throw new Error(result.error || 'Unknown error');
        storeTask(taskId, { ...result, is_album_mode: false });
        await showPlaylistGenreMenu(ctx, taskId, result);
      } catch (e: any) {
        await ctx.editMessageText(`❌ Error en AcoustID: ${e.message}`.substring(0, 3500));
      }
    } else {
      // Usar metadatos de YouTube directamente — mostrar selector de género normal
      await showPlaylistGenreMenu(ctx, taskId, task);
    }
  });

  /** Muestra el menú de selección de género para una playlist/álbum. */
  async function showPlaylistGenreMenu(ctx: any, taskId: string, data: any) {
    const totalTracks = data.tracks?.length ?? 0;
    const existingTracks = data.tracks?.filter((t: any) => t.already_exists).length ?? 0;
    const newTracks = totalTracks - existingTracks;
    const dupLabel = existingTracks > 0 ? ` (${newTracks} nuevas, ${existingTracks} ya en biblioteca)` : '';

    const keyboard = new InlineKeyboard();
    const modeLabel = data.is_album_mode ? '📀 Modo: Álbum (Homogéneo)' : '🔀 Modo: Mix (Pistas Sueltas)';
    keyboard.text(modeLabel, `togglealbum_${taskId}`).row();
    keyboard.text(`✅ Confirmar sugerido: ${data.genre}`, `confirm_${taskId}`).row();
    for (const genreKey of GENRE_MAPPING_KEYS) {
      keyboard.text(`📁 ${genreKey}`, `set_${taskId}_${genreKey}`).row();
    }
    const modeDesc = data.is_album_mode
      ? 'Se unificarán los temas bajo el mismo artista, año y carátula del álbum.'
      : 'Se respetará el artista, álbum, año y carátula individual de cada pista.';

    const replyText =
      `🎵 <b>Análisis de Álbum/Playlist Exitoso</b>\n` +
      `💿 <b>Álbum/Playlist:</b> ${data.playlist_title}\n` +
      `👤 <b>Artista/Canal:</b> ${data.playlist_artist}\n` +
      `📦 <b>Total de Pistas:</b> ${totalTracks} canciones${dupLabel}\n` +
      `🖼️ <b>Carátulas:</b> ${data.tracks_with_artwork || 0}/${totalTracks} listas\n` +
      `📝 <b>Letras:</b> ${data.tracks_with_lyrics || 0}/${totalTracks} localizadas\n` +
      `⚙️ <b>Modo Seleccionado:</b> <b>${data.is_album_mode ? 'Álbum' : 'Mix / Playlist'}</b>\n` +
      `💡 <i>${modeDesc}</i>\n\n` +
      `🧠 <b>Carpeta Destino Sugerida:</b> <code>${data.genre}</code>\n\n` +
      `Por favor selecciona una categoría para archivar todas las canciones en tu servidor:`;

    await ctx.editMessageText(replyText, { reply_markup: keyboard, parse_mode: 'HTML' });
  }

  bot.callbackQuery(/^togglealbum_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const metadata = pendingTasks.get(taskId);
    if (!metadata || !metadata.is_playlist) {
      await ctx.answerCallbackQuery({ text: "Esta tarea expiró o no es una playlist.", show_alert: true });
      return;
    }

    metadata.is_album_mode = !metadata.is_album_mode;
    storeTask(taskId, metadata);
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard();
    const modeLabel = metadata.is_album_mode ? "📀 Modo: Álbum (Homogéneo)" : "🔀 Modo: Mix (Pistas Sueltas)";
    keyboard.text(modeLabel, `togglealbum_${taskId}`).row();
    keyboard.text(`✅ Confirmar sugerido: ${metadata.genre}`, `confirm_${taskId}`).row();
    for (const genreKey of GENRE_MAPPING_KEYS) {
      keyboard.text(`📁 ${genreKey}`, `set_${taskId}_${genreKey}`).row();
    }

    const modeDesc = metadata.is_album_mode 
      ? "Se unificarán los temas bajo el mismo artista, año y carátula del álbum." 
      : "Se respetará el artista, álbum, año y carátula individual de cada pista.";

    const replyText = `🎵 <b>Análisis de Álbum/Playlist Exitoso</b>\n` +
      `💿 <b>Álbum/Playlist:</b> ${metadata.playlist_title}\n` +
      `👤 <b>Artista/Canal:</b> ${metadata.playlist_artist}\n` +
      `📦 <b>Total de Pistas:</b> ${metadata.tracks.length} canciones\n` +
      `🖼️ <b>Carátulas:</b> ${metadata.tracks_with_artwork}/${metadata.tracks.length} listas\n` +
      `📝 <b>Letras:</b> ${metadata.tracks_with_lyrics}/${metadata.tracks.length} localizadas\n` +
      `⚙️ <b>Modo Seleccionado:</b> <b>${metadata.is_album_mode ? "Álbum" : "Mix / Playlist"}</b>\n` +
      `💡 <i>${modeDesc}</i>\n\n` +
      `🧠 <b>Carpeta Destino Sugerida:</b> <code>${metadata.genre}</code>\n\n` +
      `Por favor selecciona una categoría para archivar todas las canciones en tu servidor:`;

    await ctx.editMessageText(replyText, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });
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
    const isPlaylist = metadata.is_playlist;
    const progressMsg = isPlaylist 
      ? "⚙️ Escribiendo tags ID3, inyectando letras y organizando todas las canciones en Navidrome..."
      : "⚙️ Escribiendo tags ID3, inyectando letra y enviando a Navidrome...";
    await ctx.editMessageText(progressMsg);

    try {
      const filepathArg = isPlaylist ? "" : metadata.filepath;
      const result = await runMediaProcessor(['finalize', filepathArg, JSON.stringify(metadata)]);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      pendingTasks.delete(taskId);
      const successMsg = isPlaylist
        ? `✅ <b>Operación Exitosa</b>\nSe organizaron correctamente <b>${result.tracks_count}</b> canciones del álbum en:\n<code>${result.final_path}</code>`
        : `✅ <b>Operación Exitosa</b>\nOrganizado correctamente en:\n<code>${result.final_path}</code>`;
      
      await ctx.editMessageText(successMsg, {
        parse_mode: 'HTML'
      });
    } catch (e: any) {
      console.error(`[MediaProcessor Error]`, e);
      const safeErrorMsg = `❌ Ocurrió un error escribiendo en el almacenamiento: ${e.message}`.substring(0, 3500);
      await ctx.editMessageText(safeErrorMsg);
    }
  });

  function getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }

  bot.command('app', isAdminMiddleware, async (ctx) => {
    const localIp = getLocalIpAddress();
    const url = config.webhookUrl || `http://${localIp}:3000`;
    const keyboard = new InlineKeyboard().webApp("Abrir Importador 🎵", url);

    await ctx.reply(
      "🎵 <b>Importador de Música (Mini App)</b>\n\n" +
      "Usa la interfaz gráfica interactiva para buscar/pegar listas o álbumes de YouTube Music, refinar sus metadatos y organizarlos de forma impecable.",
      {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        message_thread_id: ctx.message?.message_thread_id
      }
    );
  });

  // =========================================================================
  // CALLBACKS Y LOGICA DE ESCANEO PERIODICO DE ROMANIZACION
  // =========================================================================
  bot.callbackQuery(/^autorom_(yes|no)_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    const taskId = ctx.match[2];
    
    const task = pendingTasks.get(taskId);
    if (!task) {
      await ctx.editMessageText("❌ Esta solicitud de romanización expiró o ya fue procesada.");
      return;
    }
    
    if (action === 'no') {
      pendingTasks.delete(taskId);
      await ctx.editMessageText("❌ Operación cancelada. Se ignoró la romanización por esta vez.");
      return;
    }

    await ctx.editMessageText("⏳ Iniciando la romanización de las subcarpetas seleccionadas en el servidor...");
    
    const subdirs: string[] = task.subdirs || [];
    if (subdirs.length === 0) {
      await ctx.editMessageText("❌ No hay subcarpetas que romanizar.");
      pendingTasks.delete(taskId);
      return;
    }

    let successCount = 0;
    let allStdout = '';
    let hasError = false;
    let errorMsg = '';

    for (let i = 0; i < subdirs.length; i++) {
      const subdir = subdirs[i];
      const folderName = subdir.split(/[\\/]/).pop() || subdir;
      await ctx.editMessageText(`⏳ Procesando subcarpeta [${i + 1}/${subdirs.length}]: <code>${folderName}</code>...`, { parse_mode: 'HTML' });

      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(pythonCmd, ['romanizer.py', subdir]);
          let stdout = '';
          let stderr = '';

          proc.stdout.on('data', (data) => {
            stdout += data.toString();
          });
          proc.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          proc.on('close', (code) => {
            allStdout += stdout;
            if (code !== 0) {
              hasError = true;
              errorMsg += `Error en <b>${folderName}</b> (código ${code}): ${stderr || stdout}\n`;
            } else {
              successCount++;
            }
            resolve();
          });
        });
      } catch (err: any) {
        hasError = true;
        errorMsg += `Excepción en <b>${folderName}</b>: ${err.message}\n`;
      }
    }

    pendingTasks.delete(taskId);

    if (hasError && successCount === 0) {
      await ctx.editMessageText(`❌ <b>Error durante la romanización:</b>\n<pre>${errorMsg.substring(0, 3000)}</pre>`, { parse_mode: 'HTML' });
    } else {
      const lines = allStdout.split('\n').filter(l => l.trim().startsWith('[Archivo]') || l.trim().startsWith('[Carpeta]'));
      const summary = lines.slice(0, 20).join('\n');
      const remaining = lines.length > 20 ? `\n... y ${lines.length - 20} elementos más.` : '';
      
      const successHeader = hasError 
        ? `⚠️ <b>Romanización completada con algunos errores:</b>\n` +
          `Se procesaron con éxito <b>${successCount}/${subdirs.length}</b> subcarpetas.\n\n` +
          `<b>Errores detectados:</b>\n<pre>${errorMsg.substring(0, 1000)}</pre>\n\n`
        : `✅ <b>Romanización de subcarpetas completada con éxito</b>\n` +
          `Se procesaron <b>${successCount}</b> subcarpetas en total.\n\n`;

      await ctx.editMessageText(
        successHeader +
        `<b>Detalle de cambios:</b>\n` +
        `<pre>${summary || "No se realizaron cambios."}${remaining}</pre>`,
        { parse_mode: 'HTML' }
      );
    }
  });

  function startPeriodicRomanizeScan(botInstance: Bot) {
    const musicDir = process.env.MUSIC_DIR || (process.platform === 'win32' ? 'M:\\music' : '/media/music');
    const jMusicDir = join(musicDir, 'J-Music');

    const checkAndNotify = async () => {
      if (!existsSync(jMusicDir)) {
        console.log(`[Romanizer Scan] Carpeta J-Music no encontrada en: ${jMusicDir}`);
        return;
      }

      console.log(`[Romanizer Scan] Iniciando escaneo periódico en: ${jMusicDir}`);
      try {
        const proc = spawn(pythonCmd, ['romanizer.py', '--scan', jMusicDir]);
        let stdout = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.on('close', async (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout.trim());
              if (result.success && result.detected && result.subdirs && result.subdirs.length > 0) {
                console.log(`[Romanizer Scan] Se detectaron ${result.subdirs.length} subcarpetas que requieren romanización.`);
                
                const taskId = `autorom_${Date.now()}`;
                storeTask(taskId, { subdirs: result.subdirs });

                const keyboard = new InlineKeyboard()
                  .text("✅ Sí, romanizar", `autorom_yes_${taskId}`).row()
                  .text("❌ No, ignorar", `autorom_no_${taskId}`);

                const subdirsList = result.subdirs.map((d: string) => {
                  const name = d.split(/[\\/]/).pop() || d;
                  return `• <code>${name}</code>`;
                }).join('\n');

                const msgText = `🔍 <b>Música japonesa sin romanizar detectada en J-Music</b>\n\n` +
                  `He encontrado <b>${result.subdirs.length}</b> subcarpetas con caracteres Kanji/Kana en sus nombres o en sus archivos:\n` +
                  `${subdirsList}\n\n` +
                  `¿Deseas iniciar la romanización automática de metadatos y nombres físicos para estas carpetas?`;

                for (const adminId of config.telegramAllowedUserIds) {
                  try {
                    await botInstance.api.sendMessage(parseInt(adminId), msgText, {
                      reply_markup: keyboard,
                      parse_mode: 'HTML'
                    });
                  } catch (sendErr) {
                    console.error(`[Romanizer Scan] Error enviando mensaje a admin ${adminId}:`, sendErr);
                  }
                }
              } else {
                console.log(`[Romanizer Scan] Escaneo completado: J-Music está completamente limpia de caracteres Kanji/Kana.`);
              }
            } catch (jsonErr) {
              console.error(`[Romanizer Scan] Error parseando salida de escaneo:`, jsonErr, stdout);
            }
          } else {
            console.error(`[Romanizer Scan] Proceso de escaneo falló con código ${code}`);
          }
        });
      } catch (e) {
        console.error(`[Romanizer Scan] Error al iniciar escaneo de romanización:`, e);
      }
    };

    // Ejecutar por primera vez a los 15 segundos del inicio del bot
    setTimeout(checkAndNotify, 15000);

    // Ejecutar cada 12 horas
    setInterval(checkAndNotify, 12 * 60 * 60 * 1000);
  }

  // Lanzar el escaneo periódico
  startPeriodicRomanizeScan(bot);
}

