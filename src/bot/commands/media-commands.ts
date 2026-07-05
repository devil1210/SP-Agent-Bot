import { Bot, Context, InlineKeyboard } from 'grammy';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { isAdmin } from '../helpers.js';
import { config } from '../../config.js';

export const pendingTasks = new Map<string, any>();

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

    const taskId = ctx.message?.message_id.toString();
    if (!taskId) return;

    const msg = await ctx.reply("⏳ Descargando pista, procesando Romaji y cruzando tiendas digitales...", {
      message_thread_id: ctx.message?.message_thread_id
    });
    try {
      const result = await runMediaProcessor(['download', url, taskId, forceType]);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Caso: Múltiples candidatos encontrados en MusicBrainz para un álbum
      if (result.candidates && result.candidates.length > 0) {
        pendingTasks.set(taskId, { url, forceType, candidates: result.candidates, playlist_title: result.playlist_title, playlist_artist: result.playlist_artist, msg_id: msg.message_id });
        
        const keyboard = new InlineKeyboard();
        result.candidates.forEach((c: any, index: number) => {
          const yearLabel = c.year ? ` (${c.year})` : '';
          const tracksLabel = c.tracks ? ` [${c.tracks} tr]` : '';
          const countryLabel = c.country ? ` [${c.country}]` : '';
          keyboard.text(`💿 ${c.title}${yearLabel}${tracksLabel}${countryLabel}`, `selrel_${taskId}_${index}`).row();
        });
        keyboard.text("🚫 Usar metadatos originales de YouTube Music", `selrel_${taskId}_none`).row();

        await ctx.api.editMessageText(
          ctx.chat.id,
          msg.message_id,
          `🔍 <b>Múltiples coincidencias en MusicBrainz</b>\nSe encontraron varios candidatos para el álbum <b>${result.playlist_title}</b> de <b>${result.playlist_artist}</b>.\n\nPor favor selecciona la versión correcta o decide ignorar la búsqueda:`,
          { reply_markup: keyboard, parse_mode: 'HTML' }
        );
        return;
      }

      // Caso: El álbum o pista ya existe completo en la biblioteca
      if (result.album_exists) {
        const itemType = result.is_playlist ? 'El álbum' : 'La pista';
        const itemTitle = result.is_playlist ? result.playlist_title : (result.metadata?.title || result.title);
        const itemArtist = result.is_playlist ? result.playlist_artist : (result.metadata?.artist || result.artist);
        await ctx.api.editMessageText(
          ctx.chat.id,
          msg.message_id,
          `ℹ️ <b>Ya existe en tu biblioteca:</b>\n${itemType} <b>${itemTitle}</b> de <b>${itemArtist}</b> ya se encuentra completo en tu servidor.\n\n📂 <b>Ruta:</b> <code>${result.existing_path}</code>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Caso: Es una playlist personalizada y todas las canciones ya existen
      if (result.playlist_exists_completely) {
        result.is_album_mode = false;
        pendingTasks.set(taskId, result);

        const keyboard = new InlineKeyboard();
        keyboard.text("✅ Crear playlist en Navidrome", `confirm_${taskId}`).row();

        await ctx.api.editMessageText(
          ctx.chat.id,
          msg.message_id,
          `ℹ️ <b>Todas las canciones ya existen:</b>\nTodas las canciones de la playlist <b>${result.playlist_title}</b> ya están en tu biblioteca.\n\n¿Deseas crear el archivo de playlist (.m3u) para Navidrome con estas canciones en su orden original?`,
          { reply_markup: keyboard, parse_mode: 'HTML' }
        );
        return;
      }

      if (result.is_playlist) {
        result.is_album_mode = result.is_album_mode !== false; // true por defecto
        pendingTasks.set(taskId, result);

        const totalTracks = result.tracks.length;
        const existingTracks = result.tracks.filter((t: any) => t.already_exists).length;
        const newTracks = totalTracks - existingTracks;
        const dupLabel = existingTracks > 0 
          ? ` (${newTracks} nuevas, ${existingTracks} ya en biblioteca)` 
          : '';

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

        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, replyText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
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
        pendingTasks.set(taskId, result);

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

  bot.callbackQuery(/^togglealbum_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const metadata = pendingTasks.get(taskId);
    if (!metadata || !metadata.is_playlist) {
      await ctx.answerCallbackQuery({ text: "Esta tarea expiró o no es una playlist.", show_alert: true });
      return;
    }

    metadata.is_album_mode = !metadata.is_album_mode;
    pendingTasks.set(taskId, metadata);
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
}
