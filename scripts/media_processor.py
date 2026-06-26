import os
import sys
import json
import shutil
import glob
import logging
import requests
import pykakasi
from typing import Dict, Any, List
import yt_dlp
import musicbrainzngs
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TRCK, USLT, APIC
from mutagen.mp4 import MP4, MP4Cover

# Configurar yt-dlp para usar Node.js como runtime JS (node:20-slim ya tiene node en PATH)
# Esto evita el error "No supported JavaScript runtime could be found"
_ytdlp_config_dir = os.path.expanduser('~/.config/yt-dlp')
os.makedirs(_ytdlp_config_dir, exist_ok=True)
with open(os.path.join(_ytdlp_config_dir, 'config'), 'w') as _f:
    _f.write('--js-runtimes node\n')

# =========================================================================
# CONFIGURACIÓN GENERAL Y CONSTANTES
# =========================================================================
MUSICBRAINZ_APP = "SP-Agent"
MUSICBRAINZ_VERSION = "1.2"
MUSICBRAINZ_CONTACT = "admin@tu-dominio.com"

TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/sp-agent/downloads")
_music_dir = os.getenv("MUSIC_DIR", "/media/music")

GENRE_MAPPING = {
    "J-Music": ["j-pop", "j-rock", "anime", "japanese", "vocaloid", "jpop", "jrock"],
    "Música-Cumbias-y-Tropical": ["cumbia", "salsa", "merengue", "tropical", "bachata"],
    "Música-Rancheras": ["ranchera", "mariachi", "regional mexicano", "corridos", "corrido"],
    "Música-Reggaeton": ["reggaeton", "urbano", "perreo", "dembow", "latin pop"],
    "Música-Rock": ["rock", "metal", "punk", "grunge", "indie", "alternative rock"],
    "Música-HipHop": ["hip hop", "rap", "trap", "r&b"],
    "Música-Electronica": ["electronic", "techno", "house", "edm", "dance", "trance"],
    "Música-Pop": ["pop", "synthpop", "dance-pop", "ballad", "balada"]
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

musicbrainzngs.set_useragent(MUSICBRAINZ_APP, MUSICBRAINZ_VERSION, MUSICBRAINZ_CONTACT)
kks = pykakasi.kakasi()

# =========================================================================
# PROVEEDORES EXTERNOS DE METADATOS Y MEJORAS (iTunes, Deezer, Lrclib, Romaji)
# =========================================================================
def clean_and_romaji(text: str) -> str:
    """Detecta caracteres japoneses y los convierte a Romaji legible."""
    if not text:
        return text
    result = kks.convert(text)
    romaji_text = " ".join([item.get('hepburn', item.get('orig', '')).capitalize() for item in result])
    return romaji_text if romaji_text.strip() else text

def download_artwork(url: str, task_id: str) -> str:
    """Descarga la carátula oficial en alta resolución y la guarda temporalmente."""
    if not url:
        return ""
    try:
        res = requests.get(url, timeout=5)
        if res.status_code == 200:
            os.makedirs(TEMP_DIR, exist_ok=True)
            artwork_path = os.path.join(TEMP_DIR, f"{task_id}_cover.jpg")
            with open(artwork_path, "wb") as f:
                f.write(res.content)
            return artwork_path
    except Exception as e:
        logger.error(f"Error descargando carátula: {e}")
    return ""

def fetch_from_itunes(artist: str, title: str) -> dict:
    """Busca en iTunes API para alta precisión en lanzamientos actuales."""
    try:
        term = f"{artist} {title}"
        url = f"https://itunes.apple.com/search?term={requests.utils.quote(term)}&media=music&limit=1"
        response = requests.get(url, timeout=5)
        if response.status_code == 200 and response.json().get('resultCount', 0) > 0:
            track = response.json()['results'][0]
            artwork_url = track.get('artworkUrl100', '').replace('100x100bb.jpg', '600x600bb.jpg')
            return {
                "genre": track.get('primaryGenreName', '').lower(),
                "album": track.get('collectionName', ''),
                "artist": track.get('artistName', ''),
                "title": track.get('trackName', ''),
                "artwork_url": artwork_url
            }
    except Exception as e:
        logger.error(f"Error en iTunes API: {e}")
    return {}

def fetch_from_deezer(artist: str, title: str) -> dict:
    """Busca en Deezer API como segundo validador comercial."""
    try:
        query = f'artist:"{artist}" track:"{title}"'
        url = f"https://api.deezer.com/search?q={requests.utils.quote(query)}&limit=1"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json().get('data', [])
            if data:
                track = data[0]
                album_id = track.get('album', {}).get('id')
                genre_name = ""
                artwork_url = track.get('album', {}).get('cover_xl', '')
                if album_id:
                    album_res = requests.get(f"https://api.deezer.com/album/{album_id}", timeout=3).json()
                    genres = album_res.get('genres', {}).get('data', [])
                    if genres:
                        genre_name = genres[0].get('name', '').lower()
                    if not artwork_url:
                        artwork_url = album_res.get('cover_xl', '')
                return {
                    "genre": genre_name,
                    "album": track.get('album', {}).get('title', ''),
                    "artist": track.get('artist', {}).get('name', ''),
                    "title": track.get('title', ''),
                    "artwork_url": artwork_url
                }
    except Exception as e:
        logger.error(f"Error en Deezer API: {e}")
    return {}

def fetch_lyrics_from_lrclib(artist: str, title: str) -> str:
    """Obtiene las letras desde la API de Lrclib para incrustar en el archivo."""
    try:
        url = f"https://lrclib.net/api/search?artist={requests.utils.quote(artist)}&track_name={requests.utils.quote(title)}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200 and response.json():
            data = response.json()[0]
            return data.get('plainLyrics') or data.get('syncedLyrics') or ""
    except Exception as e:
        logger.error(f"Error buscando letras: {e}")
    return ""


# =========================================================================
# CLASE MAESTRA: PROCESADOR MULTIMEDIA
# =========================================================================
class MediaProcessor:
    @staticmethod
    def download_audio(url: str, task_id: str) -> dict:
        """Descarga el audio nativo M4A a máxima calidad desde YouTube, extrae tags nativos y aplica Romaji."""
        os.makedirs(TEMP_DIR, exist_ok=True)
        out_template = os.path.join(TEMP_DIR, f"{task_id}_%(title)s.%(ext)s")

        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'format_sort': ['acodec:aac'],           # Prioriza AAC nativo para evitar transcodificación
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'm4a',
                'preferredquality': '0',              # Máxima calidad si necesita transcodificar
            }],
            'outtmpl': out_template,
            'quiet': True,
            'extract_flat': False
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

            # Localizar el archivo real post-procesado (la extensión puede cambiar)
            pattern = os.path.join(TEMP_DIR, f"{task_id}_*.*")
            candidates = [f for f in glob.glob(pattern) if not f.endswith('_cover.jpg')]
            if candidates:
                filename = candidates[0]
            else:
                filename = ydl.prepare_filename(info)
                # Fallback: corregir extensión si fue convertido de webm
                base, ext = os.path.splitext(filename)
                if ext != '.m4a' and os.path.exists(base + '.m4a'):
                    filename = base + '.m4a'

            yt_artist = info.get('artist') or info.get('uploader') or 'Unknown Artist'
            yt_title = info.get('track') or info.get('title') or 'Unknown Title'
            yt_album = info.get('album') or 'Unknown Album'

            return {
                "filepath": filename,
                "title": clean_and_romaji(yt_title),
                "artist": clean_and_romaji(yt_artist),
                "album": clean_and_romaji(yt_album),
                "track_number": info.get('track_number', '1') or '1',
                "is_compilation": "various" in yt_artist.lower() or "compilation" in yt_album.lower(),
                "is_soundtrack": "ost" in yt_title.lower() or "soundtrack" in yt_album.lower(),
                "raw_tags": [t.lower() for t in info.get('tags', [])] if info.get('tags') else []
            }

    @staticmethod
    def fetch_genre_multi_provider(metadata: dict) -> str:
        """Filtro jerárquico inteligente cruzando iTunes -> Deezer -> MusicBrainz."""
        artist_q = metadata['artist']
        title_q = metadata['title']
        genres_found = list(metadata['raw_tags'])

        # 1. Intentar iTunes
        itunes = fetch_from_itunes(artist_q, title_q)
        if itunes.get('genre'):
            genres_found.append(itunes['genre'])
            metadata['artist'] = clean_and_romaji(itunes['artist'])
            metadata['title'] = clean_and_romaji(itunes['title'])
            metadata['album'] = clean_and_romaji(itunes['album'])
            if itunes.get('artwork_url'):
                metadata['artwork_url'] = itunes['artwork_url']
        
        # 2. Intentar Deezer
        else:
            deezer = fetch_from_deezer(artist_q, title_q)
            if deezer.get('genre'):
                genres_found.append(deezer['genre'])
            if deezer.get('title'):
                metadata['artist'] = clean_and_romaji(deezer['artist'])
                metadata['title'] = clean_and_romaji(deezer['title'])
                metadata['album'] = clean_and_romaji(deezer['album'])
            if deezer.get('artwork_url'):
                metadata['artwork_url'] = deezer['artwork_url']

        # 3. Respaldo MusicBrainz
        if len(genres_found) <= len(metadata['raw_tags']):
            try:
                res = musicbrainzngs.search_recordings(artist=artist_q, recording=title_q, limit=1)
                if res['recording-list']:
                    for tag in res['recording-list'][0].get('tag-list', []):
                        genres_found.append(tag['name'].lower())
            except Exception:
                pass

        # Evaluar el Embudo de decisión de tu servidor
        if any(kw in g for g in genres_found for kw in ["anime", "j-pop", "j-rock", "japanese", "vocaloid"]):
            return "J-Music"

        for target_folder, keywords in GENRE_MAPPING.items():
            if any(kw in g for g in genres_found for kw in keywords):
                return target_folder

        return "General-Music"

    @staticmethod
    def write_id3_tags(filepath: str, metadata: dict):
        """Inyecta los metadatos finales, letras y carátula en el contenedor MP3 o M4A."""
        ext = filepath.split('.')[-1].lower()
        artwork_bytes = b""
        if metadata.get('artwork_path') and os.path.exists(metadata['artwork_path']):
            try:
                with open(metadata['artwork_path'], "rb") as f:
                    artwork_bytes = f.read()
            except Exception as e:
                logger.error(f"Error leyendo carátula de {metadata['artwork_path']}: {e}")

        try:
            if ext == "m4a":
                audio = MP4(filepath)
                audio["\xa9nam"] = metadata['title']
                audio["\xa9ART"] = metadata['artist']
                audio["\xa9alb"] = metadata['album']
                audio["\xa9gen"] = metadata['genre']
                
                track_val = metadata.get('track_number', '1')
                try:
                    audio["trkn"] = [(int(track_val), 0)]
                except:
                    audio["trkn"] = [(1, 0)]
                
                if metadata.get('lyrics'):
                    audio["\xa9lyr"] = metadata['lyrics']
                
                if artwork_bytes:
                    audio["covr"] = [MP4Cover(artwork_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
                
                audio.save()

            elif ext == "mp3":
                audio = MP3(filepath, ID3=ID3)
                if audio.tags is None:
                    audio.add_tags()
                audio.tags.add(TIT2(encoding=3, text=metadata['title']))
                audio.tags.add(TPE1(encoding=3, text=metadata['artist']))
                audio.tags.add(TALB(encoding=3, text=metadata['album']))
                audio.tags.add(TCON(encoding=3, text=metadata['genre']))
                audio.tags.add(TRCK(encoding=3, text=str(metadata.get('track_number', '1'))))
                
                if metadata.get('lyrics'):
                    audio.tags.add(USLT(encoding=3, lang='eng', desc='Lyrics', text=metadata['lyrics']))
                
                if artwork_bytes:
                    audio.tags.add(APIC(
                        encoding=3,
                        mime='image/jpeg',
                        type=3,
                        desc='Front Cover',
                        data=artwork_bytes
                    ))
                audio.save()
        except Exception as e:
            logger.error(f"Error escribiendo tags ({ext}): {e}")
            raise e

    @staticmethod
    def move_to_library(filepath: str, metadata: dict) -> str:
        """Ubica el archivo físicamente en el disco según tu jerarquía organizativa."""
        artist = metadata['artist'].replace('/', '_').replace(':', '-')
        album = metadata['album'].replace('/', '_').replace(':', '-')
        title = metadata['title'].replace('/', '_').replace(':', '-')
        
        track_val = metadata.get('track_number', '1')
        try:
            track_no = f"{int(track_val):02d}"
        except:
            track_no = str(track_val)

        ext = filepath.split('.')[-1]

        if metadata.get('is_soundtrack'):
            final_dir = os.path.join(_music_dir, "Soundtracks", album)
        elif metadata.get('is_compilation'):
            final_dir = os.path.join(_music_dir, "Compilaciones", album)
        else:
            folder = metadata.get('genre', 'General-Music')
            final_dir = os.path.join(_music_dir, folder, artist, album)

        os.makedirs(final_dir, exist_ok=True)
        final_path = os.path.join(final_dir, f"{track_no} - {title}.{ext}")
        shutil.move(filepath, final_path)
        return final_path

    @staticmethod
    def trigger_navidrome_scan():
        """Ordena reiniciar Navidrome para gatillar la indexación instantánea."""
        os.system("docker restart navidrome")


# =========================================================================
# CLI INTERFACE FOR SPAWNING FROM NODE.JS
# =========================================================================
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No action specified"}))
        sys.exit(1)
        
    action = sys.argv[1]
    
    if action == "download":
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "Missing URL or Task ID"}))
            sys.exit(1)
        url = sys.argv[2]
        task_id = sys.argv[3]
        try:
            metadata = MediaProcessor.download_audio(url, task_id)
            suggested_genre = MediaProcessor.fetch_genre_multi_provider(metadata)
            metadata['genre'] = suggested_genre
            
            # Fetch lyrics
            lyrics = fetch_lyrics_from_lrclib(metadata['artist'], metadata['title'])
            metadata['lyrics'] = lyrics
            
            # Download cover
            if metadata.get('artwork_url'):
                art_path = download_artwork(metadata['artwork_url'], task_id)
                if art_path:
                    metadata['artwork_path'] = art_path
            
            print(json.dumps({"success": True, "metadata": metadata}))
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)
            
    elif action == "fix":
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "Missing Local Path or Task ID"}))
            sys.exit(1)
        local_path = sys.argv[2]
        task_id = sys.argv[3]
        
        if not os.path.exists(local_path):
            print(json.dumps({"success": False, "error": f"File path does not exist: {local_path}"}))
            sys.exit(1)
            
        try:
            ext = local_path.split('.')[-1].lower()
            current_artist = "Unknown"
            current_title = "Unknown"
            current_album = "Unknown"

            if ext == "mp3":
                try:
                    audio = MP3(local_path, ID3=ID3)
                    current_artist = str(audio.tags.get('TPE1', 'Unknown'))
                    current_title = str(audio.tags.get('TIT2', 'Unknown'))
                    current_album = str(audio.tags.get('TALB', 'Unknown'))
                except:
                    pass
            elif ext == "m4a":
                try:
                    audio = MP4(local_path)
                    current_artist = audio.get('\xa9ART', ['Unknown'])[0]
                    current_title = audio.get('\xa9nam', ['Unknown'])[0]
                    current_album = audio.get('\xa9alb', ['Unknown'])[0]
                except:
                    pass

            if current_title == "Unknown":
                current_title = os.path.basename(local_path).replace(f".{ext}", "")

            metadata = {
                "filepath": local_path,
                "title": clean_and_romaji(current_title),
                "artist": clean_and_romaji(current_artist),
                "album": clean_and_romaji(current_album),
                "track_number": "1",
                "raw_tags": []
            }

            suggested_genre = MediaProcessor.fetch_genre_multi_provider(metadata)
            metadata['genre'] = suggested_genre
            
            lyrics = fetch_lyrics_from_lrclib(metadata['artist'], metadata['title'])
            metadata['lyrics'] = lyrics
            
            if metadata.get('artwork_url'):
                art_path = download_artwork(metadata['artwork_url'], task_id)
                if art_path:
                    metadata['artwork_path'] = art_path
                    
            print(json.dumps({"success": True, "metadata": metadata}))
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)
            
    elif action == "finalize":
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "Missing filepath or metadata JSON"}))
            sys.exit(1)
        filepath = sys.argv[2]
        metadata_str = sys.argv[3]
        try:
            metadata = json.loads(metadata_str)
            MediaProcessor.write_id3_tags(filepath, metadata)
            final_path = MediaProcessor.move_to_library(filepath, metadata)
            
            # Clean up temp files if they were downloaded
            if metadata.get('artwork_path') and os.path.exists(metadata['artwork_path']):
                try:
                    os.remove(metadata['artwork_path'])
                except:
                    pass
            
            try:
                MediaProcessor.trigger_navidrome_scan()
            except Exception as e:
                logger.error(f"Failed to restart Navidrome container: {e}")
                
            print(json.dumps({"success": True, "final_path": final_path}))
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)
            
    else:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)
