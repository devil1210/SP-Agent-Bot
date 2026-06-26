import os
import sys
import json
import shutil
import logging
import requests
import pykakasi
from typing import Dict, Any, List
import yt_dlp
import musicbrainzngs
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TRCK, USLT

# =========================================================================
# CONFIGURACIÓN GENERAL Y CONSTANTES
# =========================================================================
MUSICBRAINZ_APP = "SP-Agent"
MUSICBRAINZ_VERSION = "1.2"
MUSICBRAINZ_CONTACT = "admin@tu-dominio.com"

# Read path locations from env with fallbacks
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
    romaji_text = " ".join([item['romaji'].capitalize() for item in result])
    return romaji_text if romaji_text.strip() else text

def fetch_from_itunes(artist: str, title: str) -> dict:
    """Busca en iTunes API para alta precisión en lanzamientos actuales."""
    try:
        term = f"{artist} {title}"
        url = f"https://itunes.apple.com/search?term={requests.utils.quote(term)}&media=music&limit=1"
        response = requests.get(url, timeout=5)
        if response.status_code == 200 and response.json().get('resultCount', 0) > 0:
            track = response.json()['results'][0]
            return {
                "genre": track.get('primaryGenreName', '').lower(),
                "album": track.get('collectionName', ''),
                "artist": track.get('artistName', ''),
                "title": track.get('trackName', '')
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
                if album_id:
                    album_res = requests.get(f"https://api.deezer.com/album/{album_id}", timeout=3).json()
                    genres = album_res.get('genres', {}).get('data', [])
                    if genres:
                        genre_name = genres[0].get('name', '').lower()
                return {
                    "genre": genre_name,
                    "album": track.get('album', {}).get('title', ''),
                    "artist": track.get('artist', {}).get('name', ''),
                    "title": track.get('title', '')
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
        """Descarga el audio desde YouTube, extrae tags nativos y aplica Romaji."""
        os.makedirs(TEMP_DIR, exist_ok=True)
        out_template = os.path.join(TEMP_DIR, f"{task_id}_%(title)s.%(ext)s")

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '320',
            }],
            'outtmpl': out_template,
            'quiet': True,
            'extract_flat': False
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info).replace('.webm', '.mp3').replace('.m4a', '.mp3')

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
        
        # 2. Intentar Deezer
        else:
            deezer = fetch_from_deezer(artist_q, title_q)
            if deezer.get('genre'):
                genres_found.append(deezer['genre'])
            if deezer.get('title'):
                metadata['artist'] = clean_and_romaji(deezer['artist'])
                metadata['title'] = clean_and_romaji(deezer['title'])
                metadata['album'] = clean_and_romaji(deezer['album'])

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
        """Inyecta los metadatos finales y las letras en el contenedor MP3."""
        try:
            audio = MP3(filepath, ID3=ID3)
            if audio.tags is None:
                audio.add_tags()
            audio.tags.add(TIT2(encoding=3, text=metadata['title']))
            audio.tags.add(TPE1(encoding=3, text=metadata['artist']))
            audio.tags.add(TALB(encoding=3, text=metadata['album']))
            audio.tags.add(TCON(encoding=3, text=metadata['genre']))
            
            # Format track number
            track_num = str(metadata.get('track_number', '1'))
            audio.tags.add(TRCK(encoding=3, text=track_num))
            
            if metadata.get('lyrics'):
                audio.tags.add(USLT(encoding=3, lang='eng', desc='Lyrics', text=metadata['lyrics']))
            audio.save()
        except Exception as e:
            logger.error(f"Error escribiendo tags: {e}")
            raise e

    @staticmethod
    def move_to_library(filepath: str, metadata: dict) -> str:
        """Ubica el archivo físicamente en el disco según tu jerarquía organizativa."""
        artist = metadata['artist'].replace('/', '_').replace(':', '-')
        album = metadata['album'].replace('/', '_').replace(':', '-')
        title = metadata['title'].replace('/', '_').replace(':', '-')
        
        # Safe track number conversion
        track_val = metadata.get('track_number', '1')
        try:
            track_no = f"{int(track_val):02d}"
        except (ValueError, TypeError):
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
            
            # Trigger Docker scan (runs non-blocking since it could fail if socket not mounted)
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
