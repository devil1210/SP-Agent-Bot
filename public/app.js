// Inicializar Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // Aplicar colores del tema de Telegram si están disponibles
  document.documentElement.style.setProperty('--bg-color', tg.themeParams.bg_color || '#0b0d11');
  document.documentElement.style.setProperty('--text-primary', tg.themeParams.text_color || '#f3f4f6');
  document.documentElement.style.setProperty('--text-secondary', tg.themeParams.hint_color || '#9ca3af');
  document.documentElement.style.setProperty('--accent-color', tg.themeParams.button_color || '#a855f7');
}

// Variables de Estado de la Aplicación
let currentTaskId = null;
let currentMetadata = null;
let pollInterval = null;
let isAlbumMode = true;

// Elementos del DOM
const stepAnalyze = document.getElementById('step-analyze');
const ytUrlInput = document.getElementById('yt-url');
const btnAnalyze = document.getElementById('btn-analyze');
const spinnerAnalyze = document.getElementById('spinner-analyze');

const statusPanel = document.getElementById('status-panel');
const statusText = document.getElementById('status-text');
const progressFill = document.getElementById('progress-fill');

const errorPanel = document.getElementById('error-panel');
const errorText = document.getElementById('error-text');
const btnErrorClose = document.getElementById('btn-error-close');

const stepEditor = document.getElementById('step-editor');
const summaryArt = document.getElementById('summary-art');
const summaryTitle = document.getElementById('summary-title');
const summaryArtist = document.getElementById('summary-artist');
const badgeTracks = document.getElementById('badge-tracks');
const badgeLyrics = document.getElementById('badge-lyrics');

const selectGenre = document.getElementById('select-genre');
const btnToggleMode = document.getElementById('btn-toggle-mode');
const albumModeLabel = document.getElementById('album-mode-label');
const modeDescText = document.getElementById('mode-desc-text');
const tracklistItems = document.getElementById('tracklist-items');

const btnImport = document.getElementById('btn-import');
const spinnerImport = document.getElementById('spinner-import');

const stepSuccess = document.getElementById('step-success');
const successMessage = document.getElementById('success-message');
const btnSuccessDone = document.getElementById('btn-success-done');

// =========================================================================
// CARGA INICIAL
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  fetchGenres();

  // Event Listeners
  btnAnalyze.addEventListener('click', handleAnalyze);
  btnToggleMode.addEventListener('click', toggleAlbumMode);
  btnImport.addEventListener('click', handleImport);
  btnSuccessDone.addEventListener('click', resetApp);
  btnErrorClose.addEventListener('click', () => errorPanel.classList.add('hide'));

  // Permitir presionar Enter en el input
  ytUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAnalyze();
  });
});

// Obtiene los géneros soportados desde el backend
async function fetchGenres() {
  try {
    const res = await fetch('/api/genres');
    const data = await res.json();
    if (data.success) {
      selectGenre.innerHTML = '';
      data.genres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = `📁 ${genre}`;
        selectGenre.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Error cargando géneros:', err);
  }
}

// =========================================================================
// PASO 1: ANÁLISIS DE LA URL
// =========================================================================
async function handleAnalyze() {
  const url = ytUrlInput.value.trim();
  if (!url) {
    showError('Por favor introduce un enlace de YouTube o YouTube Music.');
    return;
  }

  // Visuals de carga
  btnAnalyze.disabled = true;
  spinnerAnalyze.classList.remove('hide');
  errorPanel.classList.add('hide');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Error al iniciar el análisis');
    }

    currentTaskId = data.taskId;
    
    // Ocultar campo de búsqueda y mostrar panel de estado
    stepAnalyze.classList.add('hide');
    statusPanel.classList.remove('hide');
    statusText.textContent = 'Iniciando descarga y análisis...';
    progressFill.style.width = '15%';

    // Empezar a consultar progreso
    startPolling(currentTaskId);

  } catch (err) {
    showError(err.message);
    btnAnalyze.disabled = false;
    spinnerAnalyze.classList.add('hide');
  }
}

// =========================================================================
// POLLING (VERIFICACIÓN DE PROGRESO DE LA TAREA)
// =========================================================================
function startPolling(taskId) {
  let progress = 15;
  
  if (pollInterval) clearInterval(pollInterval);
  
  pollInterval = setInterval(async () => {
    try {
      // Simular progreso visual de barra
      if (progress < 90) {
        progress += 3;
        progressFill.style.width = `${progress}%`;
      }

      const res = await fetch(`/api/task-status/${taskId}`);
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Error al obtener estado de la tarea');
      }

      const task = data.task;
      
      if (task.status === 'analyzing') {
        statusText.textContent = 'Descargando audio y consultando metadatos en MusicBrainz...';
      } 
      else if (task.status === 'completed') {
        clearInterval(pollInterval);
        progressFill.style.width = '100%';
        setTimeout(() => {
          statusPanel.classList.add('hide');
          showEditor(task);
        }, 500);
      } 
      else if (task.status === 'failed') {
        throw new Error(task.error || 'La descarga o etiquetado falló');
      }

    } catch (err) {
      clearInterval(pollInterval);
      statusPanel.classList.add('hide');
      stepAnalyze.classList.remove('hide');
      btnAnalyze.disabled = false;
      spinnerAnalyze.classList.add('hide');
      showError(err.message);
    }
  }, 2000);
}

// =========================================================================
// PASO 2: RENDERIZADO Y EDICIÓN DE METADATOS
// =========================================================================
function showEditor(taskResult) {
  currentMetadata = taskResult;
  isAlbumMode = taskResult.is_playlist; // Activado por defecto si es una playlist

  // Actualizar resumen del Álbum
  summaryTitle.textContent = taskResult.playlist_title || taskResult.tracks[0]?.album || 'Canción Suelta';
  summaryArtist.textContent = taskResult.playlist_artist || taskResult.tracks[0]?.artist || 'Artista Desconocido';
  badgeTracks.textContent = `${taskResult.tracks.length} canciones`;
  badgeLyrics.textContent = `${taskResult.tracks_with_lyrics || 0} con letra`;

  // Intentar cargar la carátula del primer track si tiene
  if (taskResult.tracks[0] && taskResult.tracks[0].artwork_url) {
    summaryArt.innerHTML = `<img src="${taskResult.tracks[0].artwork_url}" alt="Cover">`;
  } else {
    summaryArt.innerHTML = `<span class="note-icon">🎵</span>`;
  }

  // Pre-seleccionar género sugerido
  if (taskResult.genre) {
    selectGenre.value = taskResult.genre;
  }

  // Configurar botón del modo
  updateAlbumModeUI();

  // Renderizar pistas
  renderTracklist(taskResult.tracks);

  // Mostrar el editor
  stepEditor.classList.remove('hide');
}

// Renderiza cada fila de canción en la lista
function renderTracklist(tracks) {
  tracklistItems.innerHTML = '';
  
  tracks.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.index = index;

    // Generar HTML de la fila
    row.innerHTML = `
      <div class="track-checkbox checked" onclick="toggleTrackActive(${index})"></div>
      <div class="track-img">
        ${track.artwork_url ? `<img src="${track.artwork_url}" alt="Cover">` : '<span style="font-size:1.2rem; opacity:0.4;">🎵</span>'}
      </div>
      <div class="track-inputs">
        <div class="track-num-title">
          <span class="track-index">${String(index + 1).padStart(2, '0')}</span>
          <input type="text" class="track-title-input" value="${track.title || ''}" placeholder="Título de la canción" onchange="updateTrackField(${index}, 'title', this.value)">
        </div>
        <input type="text" class="track-artist-input" value="${track.artist || ''}" placeholder="Artista" onchange="updateTrackField(${index}, 'artist', this.value)">
      </div>
    `;

    tracklistItems.appendChild(row);
  });
}

// Desactiva o activa una canción específica de la cola de descarga
window.toggleTrackActive = function(index) {
  const row = tracklistItems.children[index];
  const checkbox = row.querySelector('.track-checkbox');
  
  if (checkbox.classList.contains('checked')) {
    checkbox.classList.remove('checked');
    row.classList.add('disabled');
    currentMetadata.tracks[index].exclude = true;
  } else {
    checkbox.classList.add('checked');
    row.classList.remove('disabled');
    delete currentMetadata.tracks[index].exclude;
  }
};

// Actualiza en tiempo real los cambios del usuario en el objeto de metadatos
window.updateTrackField = function(index, field, value) {
  if (currentMetadata && currentMetadata.tracks[index]) {
    currentMetadata.tracks[index][field] = value;
  }
};

// Alterna entre Modo Álbum Homogéneo y Modo Mix
function toggleAlbumMode() {
  isAlbumMode = !isAlbumMode;
  updateAlbumModeUI();
}

function updateAlbumModeUI() {
  if (isAlbumMode) {
    btnToggleMode.classList.add('active');
    albumModeLabel.textContent = "📀 Modo: Álbum (Homogéneo)";
    modeDescText.textContent = "Se unificarán todos los temas bajo el mismo artista, año y carátula del álbum.";
  } else {
    btnToggleMode.classList.remove('active');
    albumModeLabel.textContent = "🔀 Modo: Mix (Pistas Sueltas)";
    modeDescText.textContent = "Se respetará el artista, álbum, año y carátula individual de cada pista.";
  }
}

// =========================================================================
// PASO 3: FINALIZACIÓN E IMPORTACIÓN
// =========================================================================
async function handleImport() {
  if (!currentMetadata) return;

  // Visuals de carga para importación
  btnImport.disabled = true;
  spinnerImport.classList.remove('hide');
  errorPanel.classList.add('hide');

  // Filtrar canciones excluidas
  const tracksToSave = currentMetadata.tracks.filter(t => !t.exclude);
  if (tracksToSave.length === 0) {
    showError('Debes seleccionar al menos una canción para importar.');
    btnImport.disabled = false;
    spinnerImport.classList.add('hide');
    return;
  }

  // Armar el payload final de metadatos
  const finalMetadata = {
    ...currentMetadata,
    tracks: tracksToSave,
    is_album_mode: isAlbumMode,
    genre: selectGenre.value
  };

  try {
    const res = await fetch('/api/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: currentTaskId,
        metadata: finalMetadata
      })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Error escribiendo los tags en el disco');
    }

    // Ocultar editor y mostrar panel de éxito
    stepEditor.classList.add('hide');
    stepSuccess.classList.remove('hide');
    successMessage.innerHTML = `Se han organizado correctamente <b>${data.tracks_count}</b> canciones de tu álbum en la carpeta:<br><code>${data.final_path}</code>`;
    
    // Notificar éxito al chat de Telegram si estamos en la app
    if (tg) {
      tg.sendData(JSON.stringify({
        success: true,
        action: 'import',
        tracks_count: data.tracks_count,
        final_path: data.final_path
      }));
    }

  } catch (err) {
    showError(err.message);
    btnImport.disabled = false;
    spinnerImport.classList.add('hide');
  }
}

// =========================================================================
// UTILIDADES Y RESET
// =========================================================================
function showError(msg) {
  errorText.textContent = msg;
  errorPanel.classList.remove('hide');
  errorPanel.scrollIntoView({ behavior: 'smooth' });
}

function resetApp() {
  currentTaskId = null;
  currentMetadata = null;
  ytUrlInput.value = '';
  btnAnalyze.disabled = false;
  spinnerAnalyze.classList.add('hide');
  btnImport.disabled = false;
  spinnerImport.classList.add('hide');
  
  stepSuccess.classList.add('hide');
  stepEditor.classList.add('hide');
  statusPanel.classList.add('hide');
  errorPanel.classList.add('hide');
  stepAnalyze.classList.remove('hide');
}
