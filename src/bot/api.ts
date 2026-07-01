import { Router } from 'express';
import { pendingTasks, runMediaProcessor } from './commands/media-commands.js';

export const apiRouter = Router();

// Catálogo de géneros soportados en el servidor
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

// Endpoint para verificar estado general de la API
apiRouter.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'SP-Agent Music API is online',
    time: new Date().toISOString()
  });
});

// Endpoint para obtener las carpetas de géneros disponibles
apiRouter.get('/genres', (req, res) => {
  res.json({
    success: true,
    genres: GENRE_MAPPING_KEYS
  });
});

// Inicia el análisis y descarga en segundo plano para evitar timeouts de HTTP
apiRouter.post('/analyze', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Falta la URL de YouTube' });
  }

  const taskId = `web_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  
  // Guardar estado inicial en memoria
  pendingTasks.set(taskId, {
    status: 'analyzing',
    url,
    startedAt: new Date().toISOString()
  });

  // Ejecutar el script en segundo plano
  runMediaProcessor(['download', url, taskId])
    .then((result) => {
      // Guardar el resultado cuando sea exitoso
      pendingTasks.set(taskId, {
        status: 'completed',
        is_playlist: !!result.is_playlist,
        playlist_title: result.playlist_title,
        playlist_artist: result.playlist_artist,
        genre: result.genre,
        tracks_with_artwork: result.tracks_with_artwork,
        tracks_with_lyrics: result.tracks_with_lyrics,
        tracks: result.tracks || [result], // Si es pista única, meter en array para normalizar frontend
        completedAt: new Date().toISOString()
      });
      console.log(`[API Analyze] Tarea ${taskId} completada con éxito.`);
    })
    .catch((err) => {
      // Registrar el error
      pendingTasks.set(taskId, {
        status: 'failed',
        error: err.message || 'Error en el procesador de medios',
        failedAt: new Date().toISOString()
      });
      console.error(`[API Analyze] Tarea ${taskId} falló:`, err);
    });

  // Responder inmediatamente con el ID de la tarea
  res.json({
    success: true,
    taskId,
    status: 'analyzing'
  });
});

// Consulta el estado actual de la tarea de descarga/análisis
apiRouter.get('/task-status/:id', (req, res) => {
  const taskId = req.params.id;
  const task = pendingTasks.get(taskId);

  if (!task) {
    return res.status(404).json({ success: false, error: 'La tarea no existe o ha expirado' });
  }

  res.json({
    success: true,
    task
  });
});

// Aplica los metadatos editados por el usuario, escribe tags ID3 y ubica los archivos
apiRouter.post('/finalize', async (req, res) => {
  const { taskId, metadata, genre } = req.body;

  if (!metadata) {
    return res.status(400).json({ success: false, error: 'Faltan los metadatos a procesar' });
  }

  // Si se envió un género específico desde el frontend, actualizarlo
  if (genre) {
    metadata.genre = genre;
  }

  const isPlaylist = !!metadata.is_playlist;
  const filepathArg = isPlaylist ? "" : metadata.filepath;

  console.log(`[API Finalize] Finalizando tarea ${taskId || 'directa'}. Modo playlist: ${isPlaylist}`);

  try {
    const result = await runMediaProcessor(['finalize', filepathArg, JSON.stringify(metadata)]);
    if (!result.success) {
      throw new Error(result.error || 'Error en la ejecución de finalize');
    }

    // Limpiar la tarea de la memoria si existía
    if (taskId) {
      pendingTasks.delete(taskId);
    }

    res.json({
      success: true,
      final_path: result.final_path,
      tracks_count: result.tracks_count || 1
    });
  } catch (err: any) {
    console.error(`[API Finalize] Error finalizando importación:`, err);
    res.status(500).json({
      success: false,
      error: err.message || 'Ocurrió un error escribiendo en el almacenamiento'
    });
  }
});
