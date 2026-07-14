import os
# Establecer umask a 0 para que todos los archivos y carpetas tengan los permisos más amplios posibles (0666 / 0777)
os.umask(0)

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
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TRCK, USLT, APIC, TDRC, TPE2, TPOS, TPUB, TMED, TXXX, TDOR, TSOP, TSOA, TSOT, TSO2, TSRC, UFID, COMM, WXXX
from mutagen.mp4 import MP4, MP4Cover

# Configurar yt-dlp para usar Node.js como runtime JS
# Esto evita el error "No supported JavaScript runtime could be found"
if os.name == 'nt':  # Windows
    _ytdlp_config_dir = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'yt-dlp')
else:  # Linux / macOS
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

TEMP_DIR = os.getenv("TEMP_DIR", "M:\\downloads" if os.name == 'nt' else "/tmp/sp-agent/downloads")
_music_dir = os.getenv("MUSIC_DIR", "M:\\music" if os.name == 'nt' else "/media/music")

GENRE_MAPPING = {
    "J-Music": ["j-pop", "j-rock", "anime", "japanese", "vocaloid", "jpop", "jrock"],
    "Cumbias-y-Tropical": ["cumbia", "salsa", "merengue", "tropical", "bachata"],
    "Rancheras": ["ranchera", "mariachi", "regional mexicano", "corridos", "corrido"],
    "Reggaeton": ["reggaeton", "urbano", "perreo", "dembow", "latin pop"],
    "Rock-Latino": ["rock latino", "rock en espanol", "rock en español", "chilean rock", "latin rock", "rock chileno", "rock argentino", "rock mexicano", "gufi", "los prisioneros", "soda stereo", "fiskales ad-hok"],
    "Rock": ["rock", "metal", "punk", "grunge", "indie", "alternative rock"],
    "HipHop": ["hip hop", "rap", "trap", "r&b"],
    "Electronica": ["electronic", "techno", "house", "edm", "dance", "trance"],
    "Pop": ["pop", "synthpop", "dance-pop", "ballad", "balada"]
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def make_writable(path: str):
    """Establece permisos de lectura y escritura globales para evitar bloqueos en Samba."""
    try:
        if os.path.exists(path):
            if os.path.isdir(path):
                os.chmod(path, 0o777)
            else:
                os.chmod(path, 0o666)
    except Exception as e:
        logger.warning(f"No se pudieron cambiar los permisos de {path}: {e}")

musicbrainzngs.set_useragent(MUSICBRAINZ_APP, MUSICBRAINZ_VERSION, MUSICBRAINZ_CONTACT)
musicbrainzngs.set_rate_limit(limit_or_interval=1.1)  # máx. 1 llamada/s a la API de MusicBrainz
kks = pykakasi.kakasi()

# =========================================================================
# PROVEEDORES EXTERNOS DE METADATOS Y MEJORAS (iTunes, Deezer, Lrclib, Romaji)
# =========================================================================
def contains_japanese(text: str) -> bool:
    """Detecta si una cadena contiene caracteres japoneses (Hiragana, Katakana o Kanji)."""
    for char in text:
        if ('\u3040' <= char <= '\u309f') or ('\u30a0' <= char <= '\u30ff') or ('\u4e00' <= char <= '\u9faf'):
            return True
    return False

def clean_and_romaji(text: str) -> str:
    """Detecta caracteres japoneses y los convierte a Romaji legible, manteniendo intactos los demás idiomas."""
    if not text:
        return text
    if not contains_japanese(text):
        return text
    result = kks.convert(text)
    romaji_text = " ".join([item.get('hepburn', item.get('orig', '')).capitalize() for item in result])
    if not romaji_text.strip():
        return text
        
    # Limpieza de espacios indeseados creados por la segmentación de pykakasi
    import re
    # 1. Quitar espacios dentro de corchetes: "[ 2017 ]" -> "[2017]"
    romaji_text = re.sub(r'\[\s*(.*?)\s*\]', r'[\1]', romaji_text)
    # 2. Quitar espacios dentro de paréntesis: "( single )" -> "(single)"
    romaji_text = re.sub(r'\(\s*(.*?)\s*\)', r'(\1)', romaji_text)
    # 3. Quitar espacio antes de comas, puntos y signos de puntuación
    romaji_text = re.sub(r'\s+([.,?!;])', r'\1', romaji_text)
    # 4. Reemplazar múltiples espacios por uno solo
    romaji_text = re.sub(r' +', ' ', romaji_text)
    
    return romaji_text.strip()

def clean_title_for_query(title: str) -> str:
    """Limpia el título de colaboraciones y sufijos comunes (Remasters, Lives, etc.) para buscar en MusicBrainz."""
    import re
    if not title:
        return title
    
    # 1. Quitar remasters, live, deluxe, etc.
    # Ej: "La Voz de los '80 (Remastered 2024)", "La Funa (Live / Remastered)"
    t = re.sub(r'(?i)\b(remastered|remaster|live|en vivo|deluxe|expanded|edition|version|special|anniversary|bonus|track)\b.*', '', title)
    
    # 2. Quitar feat/ft/with
    t = re.sub(r'(?i)\b(feat|ft|with)\b\.?\s+.*', '', t)
    
    # 3. Remover caracteres no alfanuméricos sobrantes al final o paréntesis colgantes
    t = re.sub(r'[\(\[\{\-\_/\u29f8\s\+]+$', '', t)
    t = re.sub(r'^\s*[\(\[\{\-\_/\u29f8\s\+]+', '', t)
    
    # 4. Limpiar paréntesis vacíos
    t = re.sub(r'\(\s*\)|\[\s*\]', '', t)
    
    return t.strip()

def clean_artist_for_query(artist: str) -> str:
    """Limpia la cadena del artista para realizar búsquedas más fiables en MusicBrainz."""
    import re
    if not artist:
        return artist
    # Quitar sufijos de YouTube Topic/Tema
    artist = re.sub(r'(?i)\s*-\s*(tema|topic|oficial|official|vevo|music|channel|tv)$', '', artist)
    parts = re.split(r',|;| featuring | feat\.? | and | y | & |\bft\b', artist, flags=re.IGNORECASE)
    return parts[0].strip()

def get_decade_string(year_str: str) -> str:
    """Calcula la década a partir de una fecha/año al estilo del plugin Decade de Picard."""
    import re
    if not year_str:
        return ""
    try:
        match = re.search(r'\b(19\d{2}|20\d{2})\b', year_str)
        if not match:
            return ""
        year = int(match.group(1))
        decade_val = (year // 10) * 10
        if 1920 <= decade_val <= 2000:
            return f"{str(decade_val)[2:]}s"  # "80s", "90s", "00s"
        else:
            return f"{decade_val}s"           # "2010s", "2020s"
    except:
        return ""

def get_entry_thumbnail(entry: dict) -> str:
    """Obtiene la URL de la carátula desde un entry de yt-dlp."""
    if not entry:
        return ""
    # 1. Intentar con thumbnail
    t = entry.get('thumbnail')
    if t and isinstance(t, str):
        return t
    # 2. Intentar con thumbnails
    ts = entry.get('thumbnails')
    if ts and isinstance(ts, list):
        try:
            return ts[-1].get('url') or ts[0].get('url') or ""
        except:
            pass
    return ""

def get_release_track_count(rel: dict) -> int:
    """Obtiene el número total de pistas de una release en MusicBrainz de forma segura."""
    if not rel:
        return 0
    # 1. Intentar con medium-track-count
    if 'medium-track-count' in rel and rel['medium-track-count'] is not None:
        try:
            return int(rel['medium-track-count'])
        except:
            pass
    # 2. Intentar sumando los tracks de los medios
    if 'medium-list' in rel:
        try:
            return sum(int(m.get('track-count', 0)) for m in rel.get('medium-list', []))
        except:
            pass
    # 3. Intentar con track-count
    if 'track-count' in rel and rel['track-count'] is not None:
        try:
            return int(rel['track-count'])
        except:
            pass
    return 0

def normalize_string_for_matching(s: str) -> str:
    """Normaliza un título o nombre quitando caracteres problemáticos e insignificantes para comparación segura."""
    import re
    if not s:
        return ""
    # Reemplazar slashes de yt-dlp y caracteres no alfanuméricos
    s = s.replace('\u29f8', '').replace('/', '').replace('\\', '').replace(':', '').replace('*', '').replace('?', '').replace('"', '').replace('<', '').replace('>', '').replace('|', '')
    # Quitar acentos/diacríticos comunes
    return re.sub(r'[^a-zA-Z0-9]', '', s).lower()

def search_album_candidates(playlist_title: str, playlist_artist: str) -> list:
    """Busca candidatos de release en MusicBrainz para un álbum y devuelve una lista limpia."""
    import musicbrainzngs
    candidates = []
    try:
        clean_album = clean_title_for_query(playlist_title)
        if clean_album.lower().startswith('album - '):
            clean_album = clean_album[8:].strip()
        clean_artist = clean_artist_for_query(playlist_artist)
        
        res = None
        if clean_artist and clean_artist != "Unknown Artist":
            query_with_artist = f'release:"{clean_album}" AND artist:"{clean_artist}"'
            try:
                res = musicbrainzngs.search_releases(query=query_with_artist, limit=8)
            except Exception as e:
                logger.error(f"Error buscando candidatos con artista: {e}")
        
        if not res or not res.get('release-list'):
            query_no_artist = f'release:"{clean_album}"'
            try:
                res = musicbrainzngs.search_releases(query=query_no_artist, limit=12)
            except Exception as e:
                logger.error(f"Error buscando candidatos sin artista: {e}")
                
        if res and res.get('release-list'):
            def titles_are_similar(t1: str, t2: str) -> bool:
                c1 = normalize_string_for_matching(t1)
                c2 = normalize_string_for_matching(t2)
                if not c1 or not c2:
                    return False
                return c1 in c2 or c2 in c1
                
            for rel in res.get('release-list', []):
                rel_title = rel.get('title', '')
                if titles_are_similar(clean_album, rel_title):
                    rel_artist = rel.get('artist-credit', [{}])[0].get('artist', {}).get('name', 'Unknown')
                    # Prevenir duplicados en la lista de candidatos
                    if not any(c['id'] == rel['id'] for c in candidates):
                        candidates.append({
                            "id": rel["id"],
                            "title": rel_title,
                            "artist": rel_artist,
                            "year": rel.get("date", "")[:4] if rel.get("date") else "",
                            "tracks": get_release_track_count(rel),
                            "country": rel.get("country", "")
                        })
                        if len(candidates) >= 5:
                            break
    except Exception as e:
        logger.error(f"Error obteniendo candidatos: {e}")
    return candidates

def resolve_album_release_level(playlist_title: str, playlist_artist: str, total_tracks: int) -> dict:
    """Intenta buscar la release completa en MusicBrainz y devolver sus tracks mapeados."""
    import musicbrainzngs
    try:
        clean_album = clean_title_for_query(playlist_title)
        if clean_album.lower().startswith('album - '):
            clean_album = clean_album[8:].strip()
        clean_artist = clean_artist_for_query(playlist_artist)
        
        res = None
        # Intentar buscar con artista primero
        if clean_artist and clean_artist != "Unknown Artist":
            query_with_artist = f'release:"{clean_album}" AND artist:"{clean_artist}"'
            logger.info(f"Buscando release en MusicBrainz con artista: {query_with_artist}")
            try:
                res = musicbrainzngs.search_releases(query=query_with_artist, limit=5)
            except Exception as e:
                logger.error(f"Error buscando release con artista: {e}")
        
        # Fallback sin artista
        if not res or not res.get('release-list'):
            query_no_artist = f'release:"{clean_album}"'
            logger.info(f"Buscando release en MusicBrainz sin artista: {query_no_artist}")
            try:
                res = musicbrainzngs.search_releases(query=query_no_artist, limit=15)
            except Exception as e:
                logger.error(f"Error buscando release sin artista: {e}")
                return {}
        
        def titles_are_similar(t1: str, t2: str) -> bool:
            c1 = normalize_string_for_matching(t1)
            c2 = normalize_string_for_matching(t2)
            if not c1 or not c2:
                return False
            return c1 in c2 or c2 in c1

        best_release = None
        # Buscar un match que coincida en track count, artista y título similar (Criterio Estricto)
        for rel in res.get('release-list', []):
            try:
                rel_title = rel.get('title', '')
                if not titles_are_similar(clean_album, rel_title):
                    continue
                track_count = get_release_track_count(rel)
                if track_count > 0 and abs(track_count - total_tracks) <= 2:
                    rel_artist = rel.get('artist-credit', [{}])[0].get('artist', {}).get('name', '').lower()
                    clean_rel_artist = normalize_string_for_matching(rel_artist)
                    clean_handle = normalize_string_for_matching(clean_artist)
                    # El artista DEBE coincidir
                    if not clean_handle or clean_handle == "unknownartist" or clean_rel_artist in clean_handle or clean_handle in clean_rel_artist:
                        best_release = rel
                        break
            except:
                pass
            
        if best_release:
            rel_id = best_release['id']
            logger.info(f"Release oficial confirmada: {best_release.get('title')} ({rel_id})")
            
            rel_detail = musicbrainzngs.get_release_by_id(
                rel_id,
                includes=["recordings", "artists", "labels", "release-groups", "tags", "media"]
            )
            return rel_detail.get("release", {})
    except Exception as e:
        logger.error(f"Error en resolve_album_release_level: {e}")
    return {}

def map_release_track_to_metadata(release_info: dict, track_num: int, total_tracks: int) -> dict:
    """Mapea una pista de la release de MusicBrainz a metadatos enriquecidos."""
    try:
        # Buscar la pista correspondiente en los mediums (discos)
        media_list = release_info.get('medium-list', [])
        current_track_idx = 0
        target_track = None
        target_medium = None
        
        # Buscar secuencialmente el track index global
        for medium in media_list:
            track_list = medium.get('track-list', [])
            for track in track_list:
                current_track_idx += 1
                if current_track_idx == track_num:
                    target_track = track
                    target_medium = medium
                    break
            if target_track:
                break
                
        # Si no se encontró por índice global, intentar por track number en el primer medium
        if not target_track and media_list:
            track_list = media_list[0].get('track-list', [])
            if len(track_list) >= track_num:
                target_track = track_list[track_num - 1]
                target_medium = media_list[0]
                
        if target_track:
            recording = target_track.get('recording', {})
            recording_id = recording.get('id', '')
            
            title = recording.get('title') or target_track.get('title')
            artist_credit = recording.get('artist-credit', []) or target_track.get('artist-credit', [])
            artist_name = "Unknown Artist"
            if artist_credit:
                artist_name = "".join([
                    credit['artist']['name'] + credit.get('joinphrase', '')
                    if isinstance(credit, dict) and 'artist' in credit
                    else str(credit)
                    for credit in artist_credit
                ])
                
            album_name = release_info.get('title')
            
            # Artista del álbum
            album_artist_credit = release_info.get('artist-credit', [])
            album_artist_name = artist_name
            if album_artist_credit:
                album_artist_name = "".join([
                    credit['artist']['name'] + credit.get('joinphrase', '')
                    if isinstance(credit, dict) and 'artist' in credit
                    else str(credit)
                    for credit in album_artist_credit
                ])
                
            # Fecha
            release_year = ""
            original_date = ""
            rel_date = release_info.get('date')
            if rel_date:
                release_year = rel_date[:4]
                original_date = rel_date
                
            if release_info.get("release-group"):
                rg = release_info["release-group"]
                if rg.get("first-release-date"):
                    original_date = rg["first-release-date"]
            
            # Artwork
            artwork_url = ""
            rel_id = release_info.get('id')
            if rel_id:
                artwork_url = f"https://coverartarchive.org/release/{rel_id}/front"
            
            # Tags / Genres
            tags_dict = {}
            excluded_tags = {"seen live", "favorites", "fixme", "owned"}
            
            def add_tags(tag_list):
                if not tag_list:
                    return
                for tag in tag_list:
                    name = tag.get("name", "").strip().lower()
                    if name and name not in excluded_tags:
                        try:
                            count = int(tag.get("count", 1))
                        except:
                            count = 1
                        tags_dict[name] = max(tags_dict.get(name, 0), count)
            
            add_tags(recording.get('tag-list'))
            add_tags(release_info.get('tag-list'))
            if release_info.get("release-group"):
                add_tags(release_info["release-group"].get('tag-list'))
                
            for credit in artist_credit:
                if isinstance(credit, dict) and credit.get('artist'):
                    add_tags(credit['artist'].get('tag-list'))
            for credit in album_artist_credit:
                if isinstance(credit, dict) and credit.get('artist'):
                    add_tags(credit['artist'].get('tag-list'))
                    
            sorted_tags = sorted(tags_dict.items(), key=lambda x: x[1], reverse=True)
            genres = [tag[0].title() for tag in sorted_tags[:8]]
            
            # Media info
            media_format = target_medium.get('format', 'CD') if target_medium else 'CD'
            disc_number = target_medium.get('position', '1') if target_medium else '1'
            disc_total = len(media_list)
            
            # Sort names
            artist_sort = artist_name
            albumartist_sort = album_artist_name
            if artist_credit and isinstance(artist_credit[0], dict) and artist_credit[0].get('artist'):
                artist_sort = artist_credit[0]['artist'].get('sort-name') or artist_name
            if album_artist_credit and isinstance(album_artist_credit[0], dict) and album_artist_credit[0].get('artist'):
                albumartist_sort = album_artist_credit[0]['artist'].get('sort-name') or album_artist_name
                
            return {
                "title": clean_and_romaji(title),
                "artist": clean_and_romaji(artist_name),
                "album": clean_and_romaji(album_name),
                "album_artist": clean_and_romaji(album_artist_name),
                "year": release_year,
                "original_date": original_date,
                "genres": genres,
                "musicbrainz_track_id": recording_id,
                "musicbrainz_album_id": release_info.get('id', ''),
                "musicbrainz_artist_id": artist_credit[0]['artist']['id'] if artist_credit and isinstance(artist_credit[0], dict) and artist_credit[0].get('artist') else '',
                "musicbrainz_albumartist_id": album_artist_credit[0]['artist']['id'] if album_artist_credit and isinstance(album_artist_credit[0], dict) and album_artist_credit[0].get('artist') else '',
                "musicbrainz_releasegroup_id": release_info["release-group"].get('id', '') if release_info.get("release-group") else '',
                "musicbrainz_releasetrack_id": target_track.get('id', ''),
                "track_number": str(target_track.get('position') or track_num),
                "track_total": str(len(medium.get('track-list', [])) if target_medium else total_tracks),
                "disc_number": str(disc_number),
                "disc_total": str(disc_total),
                "catalog_number": release_info.get('label-info-list', [{}])[0].get('catalog-number', '') if release_info.get('label-info-list') else '',
                "label": release_info.get('label-info-list', [{}])[0].get('label', {}).get('name', '') if release_info.get('label-info-list') and release_info.get('label-info-list')[0].get('label') else '',
                "barcode": release_info.get('barcode', ''),
                "media": media_format,
                "release_status": release_info.get('status', 'Official'),
                "release_type": release_info.get('release-group', {}).get('primary-type', 'Album'),
                "release_country": release_info.get('country', 'US'),
                "release_script": release_info.get('text-representation', {}).get('script', 'Latn'),
                "artist_sort": artist_sort,
                "albumartist_sort": albumartist_sort,
                "isrc": recording.get('isrc-list', [''])[0] if recording.get('isrc-list') else ''
            }
    except Exception as e:
        logger.error(f"Error en map_release_track_to_metadata: {e}")
    return {}

def download_artwork(url: str, task_id: str) -> str:
    """Descarga la carátula oficial en alta resolución y la guarda temporalmente."""
    if not url:
        return ""
    try:
        res = requests.get(url, timeout=20, allow_redirects=True)
        content_type = res.headers.get('Content-Type', '')
        if res.status_code == 200 and 'image' in content_type and len(res.content) > 1024:
            os.makedirs(TEMP_DIR, exist_ok=True)
            artwork_path = os.path.join(TEMP_DIR, f"{task_id}_cover.jpg")
            with open(artwork_path, "wb") as f:
                f.write(res.content)
            make_writable(artwork_path)
            return artwork_path
        elif res.status_code == 200 and 'image' not in content_type:
            logger.warning(f"Carátula URL devolvió Content-Type inesperado ({content_type}): {url}")
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
            year = ""
            if track.get('releaseDate'):
                year = track['releaseDate'][:4]
            return {
                "genre": track.get('primaryGenreName', '').lower(),
                "album": track.get('collectionName', ''),
                "artist": track.get('artistName', ''),
                "album_artist": track.get('collectionArtistName') or track.get('artistName', ''),
                "title": track.get('trackName', ''),
                "artwork_url": artwork_url,
                "year": year,
                "track_number": str(track.get('trackNumber', '1')),
                "track_total": str(track.get('trackCount', '0'))
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
                year = ""
                if album_id:
                    album_res = requests.get(f"https://api.deezer.com/album/{album_id}", timeout=3).json()
                    genres = album_res.get('genres', {}).get('data', [])
                    if genres:
                        genre_name = genres[0].get('name', '').lower()
                    if not artwork_url:
                        artwork_url = album_res.get('cover_xl', '')
                    if album_res.get('release_date'):
                        year = album_res['release_date'][:4]
                return {
                    "genre": genre_name,
                    "album": track.get('album', {}).get('title', ''),
                    "artist": track.get('artist', {}).get('name', ''),
                    "album_artist": track.get('artist', {}).get('name', ''),
                    "title": track.get('title', ''),
                    "artwork_url": artwork_url,
                    "year": year,
                    "track_number": str(track.get('track_position', '1'))
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

def fetch_from_acoustid(filepath: str) -> dict:
    """Calcula la huella digital del archivo de audio con fpcalc y busca coincidencias en AcoustID."""
    fpcalc_bin = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fpcalc.exe")
    if not os.path.exists(fpcalc_bin):
        import shutil
        fpcalc_bin = shutil.which("fpcalc")
        
    if not fpcalc_bin:
        logger.error("No se encontró el ejecutable fpcalc (local ni global en el PATH)")
        return {}
    
    try:
        # Ejecutar fpcalc para obtener duración y huella digital en JSON
        import subprocess
        cmd = [fpcalc_bin, "-json", filepath]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        data = json.loads(res.stdout)
        duration = data.get("duration")
        fingerprint = data.get("fingerprint")
        
        if not duration or not fingerprint:
            logger.error("No se pudo obtener duración o huella digital desde fpcalc")
            return {}
        
        # Consultar AcoustID API
        client_key = "8XaBELvH"
        url = "https://api.acoustid.org/v2/lookup"
        params = {
            "client": client_key,
            "meta": "recordings releasegroups releases",
            "duration": int(duration),
            "fingerprint": fingerprint
        }
        
        response = requests.get(url, params=params, timeout=8)
        if response.status_code != 200:
            logger.error(f"Error en respuesta de AcoustID API: {response.status_code}")
            return {}
            
        res_data = response.json()
        if res_data.get("status") != "ok" or not res_data.get("results"):
            logger.info(f"AcoustID no encontró coincidencias para {os.path.basename(filepath)}")
            return {}
            
        results = res_data["results"]
        results.sort(key=lambda x: x.get("score", 0.0), reverse=True)
        
        for r in results:
            if r.get("score", 0.0) < 0.65:
                continue
            recordings = r.get("recordings", [])
            for rec in recordings:
                recording_id = rec.get("id")
                if recording_id:
                    logger.info(f"¡Huella identificada exitosamente! AcoustID Score: {r.get('score')} -> MBID: {recording_id}")
                    return {
                        "musicbrainz_id": recording_id,
                        "acoustid_id": r.get("id"),
                        "acoustid_score": r.get("score")
                    }
    except Exception as e:
        logger.error(f"Error procesando huella AcoustID para {filepath}: {e}")
    return {}

def fetch_from_musicbrainz_id(recording_id: str) -> dict:
    """Consulta los metadatos detallados en MusicBrainz usando el Recording ID oficial."""
    try:
        res = musicbrainzngs.get_recording_by_id(
            recording_id, 
            includes=["releases", "artists", "tags"]
        )
        
        recording = res.get("recording", {})
        if not recording:
            return {}
            
        title = recording.get("title")
        
        # 1. Obtener ISRC
        isrc_list = recording.get("isrc-list", [])
        isrc = isrc_list[0] if isrc_list else ""
        
        artist_credit = recording.get("artist-credit", [])
        artist_name = "Unknown Artist"
        mb_artist_id = ""
        artist_sort = ""
        if artist_credit:
            artist_name = "".join([
                credit.get("artist", {}).get("name", "") + credit.get("joinphrase", "")
                for credit in artist_credit if isinstance(credit, dict)
            ]).strip() or artist_credit[0].get("artist", {}).get("name", "Unknown Artist")
            mb_artist_id = artist_credit[0].get("artist", {}).get("id", "")
            artist_sort = artist_credit[0].get("artist", {}).get("sort-name", "")
            
        album_name = "Unknown Album"
        album_artist_name = ""
        release_year = ""
        release_id = ""
        mb_albumartist_id = ""
        mb_releasegroup_id = ""
        original_date = ""
        track_number = ""
        track_total = ""
        disc_number = 1
        disc_total = 1
        catalog_number = ""
        label_name = ""
        barcode = ""
        media_format = ""
        mb_releasetrack_id = ""
        
        # Nuevos campos de Picard
        release_status = "official"
        release_type = "album"
        release_country = "US"
        release_script = "Latn"
        albumartist_sort = ""
        
        releases = recording.get("release-list", [])
        if releases:
            best_release = releases[0]
            for rel in releases:
                if rel.get("date"):
                    best_release = rel
                    break
            album_name = best_release.get("title", "Unknown Album")
            release_id = best_release.get("id")
            
            if best_release.get("release-group"):
                mb_releasegroup_id = best_release["release-group"].get("id", "")
            
            rel_date = best_release.get("date")
            if rel_date:
                release_year = rel_date[:4]
                
            # Consultar el detalle de la release para obtener datos estructurados
            if release_id:
                try:
                    rel_detail = musicbrainzngs.get_release_by_id(
                        release_id,
                        includes=["recordings", "artists", "labels", "release-groups", "tags", "media"]
                    )
                    release_info = rel_detail.get("release", {})
                    
                    release_status = release_info.get("status", "official")
                    release_country = release_info.get("country", "US")
                    release_script = release_info.get("text-representation", {}).get("script", "Latn")
                    
                    if release_info.get("release-group"):
                        release_type = release_info["release-group"].get("type", "album")
                    
                    # Obtener el nombre del artista del álbum
                    rel_artist_credit = release_info.get("artist-credit", [])
                    if rel_artist_credit:
                        mb_albumartist_id = rel_artist_credit[0].get("artist", {}).get("id", "")
                        albumartist_sort = rel_artist_credit[0].get("artist", {}).get("sort-name", "")
                        album_artist_name = "".join([
                            credit.get("artist", {}).get("name", "") + credit.get("joinphrase", "")
                            for credit in rel_artist_credit if isinstance(credit, dict)
                        ]).strip() or rel_artist_credit[0].get("artist", {}).get("name", "")
                    
                    # Obtener número de catálogo y sello discográfico
                    label_info_list = release_info.get("label-info-list", [])
                    if label_info_list:
                        catalog_number = label_info_list[0].get("catalog-number", "")
                        label_name = label_info_list[0].get("label", {}).get("name", "")
                    
                    # Obtener barcode y media format
                    barcode = release_info.get("barcode", "")
                    medium_list = release_info.get("medium-list", [])
                    disc_total = len(medium_list)
                    
                    # Buscar esta grabación específica en los medios de la release
                    for m_idx, medium in enumerate(medium_list):
                        if m_idx == 0:
                            media_format = medium.get("format", "")
                        tracks_list = medium.get("track-list", [])
                        for track in tracks_list:
                            if track.get("recording", {}).get("id") == recording_id:
                                disc_number = m_idx + 1
                                track_number = track.get("number") or track.get("position", "")
                                track_total = len(tracks_list)
                                mb_releasetrack_id = track.get("id", "")
                                break
                        if track_number:
                            break
                except Exception as rel_err:
                    logger.error(f"Error consultando detalle de release {release_id} en MusicBrainz: {rel_err}")
            
        if not mb_albumartist_id:
            mb_albumartist_id = mb_artist_id
        if not album_artist_name:
            album_artist_name = artist_name
            
        # Intentar obtener release_group_id y original_date del release-group-list
        if recording.get("release-group-list"):
            rg_list = recording.get("release-group-list", [])
            if rg_list:
                if not mb_releasegroup_id:
                    mb_releasegroup_id = rg_list[0].get("id", "")
                original_date = rg_list[0].get("first-release-date", "")
                if original_date and not release_year:
                    release_year = original_date[:4]
                    
        if not original_date and releases:
            original_date = best_release.get("date", "")
                    
        artwork_url = ""
        if release_id:
            try:
                caa_url = f"https://coverartarchive.org/release/{release_id}"
                caa_res = requests.get(caa_url, timeout=5)
                if caa_res.status_code == 200:
                    caa_data = caa_res.json()
                    images = caa_data.get("images", [])
                    for img in images:
                        if img.get("front") and img.get("image"):
                            artwork_url = img.get("image")
                            break
            except Exception as caa_err:
                logger.error(f"Error consultando Cover Art Archive para release {release_id}: {caa_err}")
                
        # Agregar etiquetas (tags) de todas las fuentes cruzadas como hace Picard
        tags_dict = {}
        excluded_tags = {"seen live", "favorites", "fixme", "owned"}
        
        def add_tags(tag_list):
            if not tag_list:
                return
            for tag in tag_list:
                name = tag.get("name", "").strip().lower()
                if name and name not in excluded_tags:
                    try:
                        count = int(tag.get("count", 1))
                    except:
                        count = 1
                    tags_dict[name] = max(tags_dict.get(name, 0), count)
        
        # 1. Tags de la grabación
        add_tags(recording.get("tag-list"))
        
        # 2. Tags de la release y del release group
        if 'release_info' in locals():
            add_tags(release_info.get("tag-list"))
            if release_info.get("release-group"):
                add_tags(release_info["release-group"].get("tag-list"))
                
        # 3. Tags de los artistas involucrados (artist-credit)
        for credit in artist_credit:
            if isinstance(credit, dict) and credit.get("artist"):
                add_tags(credit["artist"].get("tag-list"))
        if 'release_info' in locals() and release_info.get("artist-credit"):
            for credit in release_info["artist-credit"]:
                if isinstance(credit, dict) and credit.get("artist"):
                    add_tags(credit["artist"].get("tag-list"))
                    
        # Ordenar por votos/puntuación de forma descendente y tomar máximo 8
        sorted_tags = sorted(tags_dict.items(), key=lambda x: x[1], reverse=True)
        genres = [tag[0].title() for tag in sorted_tags[:8]]
            
        return {
            "title": clean_and_romaji(title),
            "artist": clean_and_romaji(artist_name),
            "album": clean_and_romaji(album_name),
            "album_artist": clean_and_romaji(album_artist_name),
            "year": release_year,
            "original_date": original_date,
            "artwork_url": artwork_url,
            "genres": genres,
            "musicbrainz_track_id": recording_id,
            "musicbrainz_album_id": release_id,
            "musicbrainz_artist_id": mb_artist_id,
            "musicbrainz_albumartist_id": mb_albumartist_id,
            "musicbrainz_releasegroup_id": mb_releasegroup_id,
            "musicbrainz_releasetrack_id": mb_releasetrack_id,
            "track_number": track_number,
            "track_total": track_total,
            "disc_number": disc_number,
            "disc_total": disc_total,
            "catalog_number": catalog_number,
            "label": label_name,
            "barcode": barcode,
            "media": media_format,
            "release_status": release_status,
            "release_type": release_type,
            "release_country": release_country,
            "release_script": release_script,
            "artist_sort": artist_sort or artist_name,
            "albumartist_sort": albumartist_sort or album_artist_name,
            "isrc": isrc
        }
    except Exception as e:
        logger.error(f"Error consultando metadatos en MusicBrainz por ID {recording_id}: {e}")
    return {}


# =========================================================================
# CLASE MAESTRA: PROCESADOR MULTIMEDIA
# =========================================================================
class MediaProcessor:
    @staticmethod
    def find_existing_track_in_library(artist: str, title: str) -> str:
        """Busca si la canción ya existe en la biblioteca física para evitar duplicados."""
        if not artist or not title:
            return ""
        # Limpiar nombres para comparación segura
        safe_artist = clean_and_romaji(artist).lower().replace('/', '_').replace(':', '-')
        safe_title = clean_and_romaji(title).lower().replace('/', '_').replace(':', '-')
        
        # Quitar colaboraciones comunes de la comparación
        import re
        clean_title_cmp = re.sub(r'(?i)\b(feat|ft|with)\b\.?\s+.*', '', safe_title).strip()
        
        # Detectar palabras clave para evitar falsos positivos de covers/tributos/remixes
        cover_keywords = ["cover", "tribute", "tributo", "remix"]
        has_cover_in_search = any(word in clean_title_cmp for word in cover_keywords)
        
        # 1. Intentar buscar en directorios del artista primero
        for root, dirs, files in os.walk(_music_dir):
            if ".tmp" in root or "Playlists" in root:
                continue
            if safe_artist in root.lower():
                for f in files:
                    if f.lower().endswith(('.mp3', '.m4a')):
                        f_clean = re.sub(r'(?i)\b(feat|ft|with)\b\.?\s+.*', '', f.lower())
                        if clean_title_cmp in f_clean:
                            has_cover_in_file = any(word in f_clean or word in root.lower() for word in cover_keywords)
                            if has_cover_in_search == has_cover_in_file:
                                return os.path.join(root, f)
                            
        # 2. Búsqueda global en toda la biblioteca
        for root, dirs, files in os.walk(_music_dir):
            if ".tmp" in root or "Playlists" in root:
                continue
            for f in files:
                if f.lower().endswith(('.mp3', '.m4a')):
                    f_clean = re.sub(r'(?i)\b(feat|ft|with)\b\.?\s+.*', '', f.lower())
                    if clean_title_cmp in f_clean:
                        if safe_artist in f_clean or safe_artist in root.lower():
                            has_cover_in_file = any(word in f_clean or word in root.lower() for word in cover_keywords)
                            if has_cover_in_search == has_cover_in_file:
                                return os.path.join(root, f)
        return ""

    @staticmethod
    def download_audio(url: str, task_id: str, force_type: str = None, chosen_release_id: str = None) -> dict:
        """Analiza la biblioteca local y descarga solo las canciones faltantes de álbumes/playlists."""
        os.makedirs(TEMP_DIR, exist_ok=True)
        # Usar %(id)s en lugar de %(title)s para nombres de archivo deterministas (evita race condition)
        out_template = os.path.join(TEMP_DIR, f"{task_id}_%(id)s.%(ext)s")

        is_album = "OLAK5uy" in url or force_type == "album"
        ydl_opts_flat = {
            # extract_flat=False siempre: necesitamos el campo 'artist' por track para detección correcta
            'extract_flat': False,
            'quiet': True,
            'no_warnings': True,
        }
        cookies_path = os.getenv("COOKIES_PATH")
        if cookies_path and os.path.exists(cookies_path):
            ydl_opts_flat['cookiefile'] = cookies_path

        # 1. Analizar metadatos planos (sin descargar)
        with yt_dlp.YoutubeDL(ydl_opts_flat) as ydl_flat:
            flat_info = ydl_flat.extract_info(url, download=False)
            
            # Detectar si es playlist/álbum
            if flat_info.get('_type') == 'playlist' or 'entries' in flat_info:
                playlist_title = flat_info.get('title') or 'Unknown Album'
                playlist_uploader = flat_info.get('artist') or flat_info.get('uploader') or 'Unknown Artist'
                playlist_id = flat_info.get('id', '')
                is_custom_playlist = bool(playlist_id and not playlist_id.startswith('OLAK5uy'))
                if force_type == "album":
                    is_custom_playlist = False
                elif force_type == "playlist":
                    is_custom_playlist = True
                
                entries = flat_info.get('entries', [])
                tracks = []
                missing_entries = []
                
                # Verificar qué tracks ya existen en la biblioteca
                for i, entry in enumerate(entries):
                    if not entry:
                        continue
                    entry_title = entry.get('title') or entry.get('track') or 'Unknown Title'
                    entry_artist = entry.get('artist') or entry.get('creator') or entry.get('uploader') or playlist_uploader
                    
                    local_path = MediaProcessor.find_existing_track_in_library(entry_artist, entry_title)
                    if local_path:
                        tracks.append({
                            "filepath": local_path,
                            "title": clean_and_romaji(entry_title),
                            "artist": clean_and_romaji(entry_artist),
                            "album": clean_and_romaji(entry.get('album') or playlist_title),
                            "track_number": str(entry.get('playlist_index') or entry.get('track_number') or (i + 1)),
                            "track_total": str(len(entries)),
                            "artwork_url": get_entry_thumbnail(entry),
                            "already_exists": True
                        })
                    else:
                        missing_entries.append((i, entry))
                
                # Obtener el artista mayoritario limpio de la playlist
                playlist_artist = 'Unknown Artist'
                if entries:
                    # Priorizar nombres de artista distintos al uploader (para evitar nombres de canales tipo joevasconcellosoficial)
                    artists = [e.get('artist') or e.get('uploader') for e in entries if e]
                    clean_artists = [a for a in artists if a and a != 'Unknown Artist' and a.lower() != playlist_uploader.lower()]
                    if clean_artists:
                        from collections import Counter
                        playlist_artist = Counter(clean_artists).most_common(1)[0][0]
                
                if playlist_artist == 'Unknown Artist' or not playlist_artist:
                    # Si no hay alternativos, incluir el uploader
                    artists = [e.get('artist') or e.get('uploader') or playlist_uploader for e in entries if e]
                    artists = [a for a in artists if a and a != 'Unknown Artist']
                    if artists:
                        from collections import Counter
                        playlist_artist = Counter(artists).most_common(1)[0][0]
                
                if playlist_artist == 'Unknown Artist' or not playlist_artist:
                    playlist_artist = playlist_uploader

                # Caso A: Si es un álbum oficial y ya está completo
                if not is_custom_playlist and len(missing_entries) == 0 and len(entries) > 0:
                    logger.info(f"Álbum '{playlist_title}' ya existe por completo en la biblioteca.")
                    return {
                        "is_playlist": True,
                        "playlist_title": clean_and_romaji(playlist_title),
                        "playlist_artist": clean_and_romaji(playlist_artist),
                        "album_exists": True,
                        "existing_path": os.path.dirname(tracks[0]['filepath']),
                        "tracks": tracks
                    }
                
                # Caso B: Si es una playlist/mix y todas las canciones ya existen
                if is_custom_playlist and len(missing_entries) == 0 and len(entries) > 0:
                    logger.info(f"Playlist '{playlist_title}' tiene todas sus canciones en la biblioteca.")
                    return {
                        "is_playlist": True,
                        "is_custom_playlist": True,
                        "playlist_title": clean_and_romaji(playlist_title),
                        "playlist_artist": clean_and_romaji(playlist_artist),
                        "playlist_exists_completely": True,
                        "tracks": tracks
                    }
                
                # Caso C: Faltan descargar algunas (o todas) las pistas
                if len(missing_entries) > 0:
                    ydl_opts_down = {
                        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
                        'remote_components': ['ejs:github'],
                        'js_runtimes': {'node': {}},
                        'postprocessors': [
                            {
                                'key': 'SponsorBlock',
                                'when': 'pre_process',
                                'categories': ['sponsor', 'intro', 'outro', 'selfpromo', 'preview', 'filler', 'interaction', 'music_offtopic'],
                            },
                            {
                                'key': 'ModifyChapters',
                                'remove_sponsor_segments': ['sponsor', 'intro', 'outro', 'selfpromo', 'preview', 'filler', 'interaction', 'music_offtopic'],
                            },
                            {
                                'key': 'FFmpegExtractAudio',
                                'preferredcodec': 'm4a',
                                'preferredquality': '0',
                            }
                        ],
                        'outtmpl': out_template,
                        'quiet': True,
                        'noprogress': True,
                        'no_warnings': True,
                        'ignoreerrors': True,
                        'retries': 10,
                        'fragment_retries': 10,
                        'concurrent_fragment_downloads': 5,
                        'sleep_interval': 1,
                        'max_sleep_interval': 3,
                        'playlist_items': ",".join(str(idx + 1) for idx, _ in missing_entries)
                    }
                    if cookies_path and os.path.exists(cookies_path):
                        ydl_opts_down['cookiefile'] = cookies_path

                    logger.info(f"Descargando {len(missing_entries)} pistas faltantes de {len(entries)} totales en una sola sesion.")
                    try:
                        with yt_dlp.YoutubeDL(ydl_opts_down) as ydl_down:
                            ydl_down.extract_info(url, download=True)
                    except Exception as de:
                        logger.error(f"Error descargando tracks filtrados de playlist: {de}")
                
                # Recopilar los recién descargados de TEMP_DIR y completar la lista tracks
                for i, entry in enumerate(entries):
                    if not entry:
                        continue
                    
                    # Si ya existía, ya está en tracks
                    if any(t.get('track_number') == str(i + 1) for t in tracks):
                        continue
                        
                    entry_title = entry.get('title') or entry.get('track') or 'Unknown Title'
                    entry_id = entry.get('id', '')
                    
                    filename = ""
                    # 1. Búsqueda exacta por ID del video (determinista, requiere out_template con %(id)s)
                    if entry_id:
                        for _ext in ('m4a', 'mp3', 'opus', 'webm', 'ogg'):
                            _cand = os.path.join(TEMP_DIR, f"{task_id}_{entry_id}.{_ext}")
                            if os.path.exists(_cand):
                                filename = _cand
                                break
                    
                    # 2. Fallback: buscar por título normalizado si el ID no funciona
                    if not filename:
                        pattern = os.path.join(TEMP_DIR, f"{task_id}_*.*")
                        candidates = [f for f in glob.glob(pattern) if not f.endswith('_cover.jpg')]
                        if candidates:
                            already_used = [t['filepath'] for t in tracks]
                            avail = [c for c in candidates if c not in already_used]
                            if avail:
                                norm_entry_title = normalize_string_for_matching(entry_title)
                                best_cand = None
                                for c in avail:
                                    norm_cand = normalize_string_for_matching(os.path.basename(c))
                                    if norm_entry_title in norm_cand or norm_cand in norm_entry_title:
                                        best_cand = c
                                        break
                                filename = best_cand or avail[0]
                            
                    if filename and os.path.exists(filename):
                        entry_artist = entry.get('artist') or entry.get('creator') or entry.get('uploader') or playlist_uploader
                        entry_album = entry.get('album') or playlist_title
                        entry_year = entry.get('release_year') or (entry.get('release_date')[:4] if entry.get('release_date') else '') or (entry.get('upload_date')[:4] if entry.get('upload_date') else '')
                        entry_date = entry.get('release_date') or entry.get('upload_date') or ""
                        
                        tracks.append({
                            "filepath": filename,
                            "title": clean_and_romaji(entry_title),
                            "artist": clean_and_romaji(entry_artist),
                            "album": clean_and_romaji(entry_album),
                            "track_number": str(i + 1),
                            "track_total": str(len(entries)),
                            "year": str(entry_year),
                            "original_date": str(entry_date),
                            "genre": entry.get('genre', ''),
                            "webpage_url": f"https://www.youtube.com/watch?v={entry['id']}" if entry.get('id') else url,
                            "description": entry.get('description', ''),
                            "artwork_url": get_entry_thumbnail(entry),
                            "is_compilation": "various" in entry_artist.lower() or "compilation" in entry_album.lower(),
                            "is_soundtrack": "ost" in entry_title.lower() or "soundtrack" in entry_album.lower(),
                            "raw_tags": [t.lower() for t in entry.get('tags', [])] if entry.get('tags') else []
                        })
                
                # Re-ordenar tracks para mantener la estructura original
                try:
                    tracks.sort(key=lambda x: int(x.get('track_number', '1') or '1'))
                except:
                    pass

                return {
                    "is_playlist": True,
                    "is_custom_playlist": is_custom_playlist,
                    "playlist_title": clean_and_romaji(playlist_title),
                    "playlist_artist": clean_and_romaji(playlist_artist),
                    "tracks": tracks
                }
            
            else:
                # Caso de una sola canción (comportamiento original)
                yt_artist = flat_info.get('artist') or flat_info.get('uploader') or 'Unknown Artist'
                yt_title = flat_info.get('track') or flat_info.get('title') or 'Unknown Title'
                
                # Verificar duplicados para singles
                local_path = MediaProcessor.find_existing_track_in_library(yt_artist, yt_title)
                if local_path:
                    logger.info(f"Pista '{yt_title}' de '{yt_artist}' ya existe en la biblioteca.")
                    return {
                        "is_playlist": False,
                        "album_exists": True,
                        "existing_path": local_path,
                        "metadata": {
                            "filepath": local_path,
                            "title": clean_and_romaji(yt_title),
                            "artist": clean_and_romaji(yt_artist),
                            "album": clean_and_romaji(flat_info.get('album') or 'Unknown Album')
                        }
                    }

                # Descargar single
                ydl_opts_down = {
                    'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
                    'remote_components': ['ejs:github'],
                    'js_runtimes': {'node': {}},
                    'postprocessors': [
                        {
                            'key': 'SponsorBlock',
                            'when': 'pre_process',
                            'categories': ['sponsor', 'intro', 'outro', 'selfpromo', 'preview', 'filler', 'interaction', 'music_offtopic'],
                        },
                        {
                            'key': 'ModifyChapters',
                            'remove_sponsor_segments': ['sponsor', 'intro', 'outro', 'selfpromo', 'preview', 'filler', 'interaction', 'music_offtopic'],
                        },
                        {
                            'key': 'FFmpegExtractAudio',
                            'preferredcodec': 'm4a',
                            'preferredquality': '0',
                        }
                    ],
                    'outtmpl': out_template,
                    'quiet': True,
                    'noprogress': True,
                    'no_warnings': True,
                    'ignoreerrors': True,
                    'retries': 10,
                    'fragment_retries': 10,
                    'concurrent_fragment_downloads': 5
                }
                if cookies_path and os.path.exists(cookies_path):
                    ydl_opts_down['cookiefile'] = cookies_path

                with yt_dlp.YoutubeDL(ydl_opts_down) as ydl_down:
                    info = ydl_down.extract_info(url, download=True)
                    
                pattern = os.path.join(TEMP_DIR, f"{task_id}_*.*")
                candidates = [f for f in glob.glob(pattern) if not f.endswith('_cover.jpg')]
                if candidates:
                    filename = candidates[0]
                else:
                    filename = ydl_down.prepare_filename(info)
                    base, ext = os.path.splitext(filename)
                    if ext != '.m4a' and os.path.exists(base + '.m4a'):
                        filename = base + '.m4a'

                yt_artist = info.get('artist') or info.get('uploader') or 'Unknown Artist'
                yt_title = info.get('track') or info.get('title') or 'Unknown Title'
                yt_album = info.get('album') or 'Unknown Album'
                
                release_year = info.get('release_year') or (info.get('release_date')[:4] if info.get('release_date') else '') or (info.get('upload_date')[:4] if info.get('upload_date') else '')
                release_date = info.get('release_date') or info.get('upload_date') or ""

                return {
                    "is_playlist": False,
                    "filepath": filename,
                    "title": clean_and_romaji(yt_title),
                    "artist": clean_and_romaji(yt_artist),
                    "album": clean_and_romaji(yt_album),
                    "track_number": str(info.get('track_number') or info.get('playlist_index') or '1'),
                    "track_total": str(info.get('track_total') or info.get('n_entries') or ''),
                    "year": str(release_year),
                    "original_date": str(release_date),
                    "genre": info.get('genre', ''),
                    "webpage_url": info.get('webpage_url', ''),
                    "description": info.get('description', ''),
                    "is_compilation": "various" in yt_artist.lower() or "compilation" in yt_album.lower(),
                    "is_soundtrack": "ost" in yt_title.lower() or "soundtrack" in yt_album.lower(),
                    "raw_tags": [t.lower() for t in info.get('tags', [])] if info.get('tags') else []
                }

    @staticmethod
    def fetch_genre_multi_provider(metadata: dict, is_album_track: bool = False) -> str:
        """Filtro jerárquico inteligente cruzando AcoustID -> iTunes -> Deezer -> MusicBrainz.
        
        Args:
            is_album_track: Si True, omite AcoustID (la release de MusicBrainz es la fuente primaria
                            para álbumes — Spec §1.A).
        """
        filepath = metadata.get("filepath")
        genres_found = []
        acoustid_success = False

        artist_q = metadata['artist']
        title_q = metadata['title']

        # 1. Obtener géneros comerciales y artwork desde iTunes/Deezer como base
        itunes = fetch_from_itunes(artist_q, title_q)
        if itunes.get('genre'):
            genres_found.append(itunes['genre'])
            if not metadata.get('artwork_url') and itunes.get('artwork_url'):
                metadata['artwork_url'] = itunes['artwork_url']
            for key in ['year', 'album_artist', 'track_number', 'track_total']:
                if itunes.get(key) and not metadata.get(key):
                    metadata[key] = itunes[key]

        deezer = fetch_from_deezer(artist_q, title_q)
        if deezer.get('genre'):
            genres_found.append(deezer['genre'])
            if not metadata.get('artwork_url') and deezer.get('artwork_url'):
                metadata['artwork_url'] = deezer['artwork_url']
            for key in ['year', 'album_artist', 'track_number']:
                if deezer.get(key) and not metadata.get(key):
                    metadata[key] = deezer[key]

        # 2. Intentar identificación por Huella de Audio (AcoustID / Picard Scan)
        # Para tracks de álbumes, AcoustID no se usa — la release de MusicBrainz es la fuente primaria (Spec §1.A)
        if filepath and os.path.exists(filepath) and not is_album_track:
            logger.info(f"Iniciando escaneo AcoustID para: {os.path.basename(filepath)}")
            acoustid_res = fetch_from_acoustid(filepath)
            if acoustid_res.get("musicbrainz_id"):
                mb_id = acoustid_res["musicbrainz_id"]
                if acoustid_res.get("acoustid_id"):
                    metadata['acoustid_id'] = acoustid_res['acoustid_id']
                mb_meta = fetch_from_musicbrainz_id(mb_id)
                if mb_meta:
                    # Validar si el artista de AcoustID coincide razonablemente con el original de YT para evitar falsos positivos
                    yt_art_clean = normalize_string_for_matching(artist_q)
                    mb_art_clean = normalize_string_for_matching(mb_meta.get('artist', ''))
                    if yt_art_clean and mb_art_clean and yt_art_clean not in mb_art_clean and mb_art_clean not in yt_art_clean:
                        logger.warning(f"Conflicto de artista en AcoustID para {os.path.basename(filepath)}: original '{artist_q}', AcoustID '{mb_meta.get('artist')}'. Ignorando AcoustID.")
                        mb_meta = None
                    else:
                        metadata['artist'] = mb_meta['artist']
                        metadata['title'] = mb_meta['title']
                        metadata['album'] = mb_meta['album']
                    if mb_meta.get('year'):
                        metadata['year'] = mb_meta['year']
                    if mb_meta.get('original_date'):
                        metadata['original_date'] = mb_meta['original_date']
                    if mb_meta.get('artwork_url'):
                        metadata['artwork_url'] = mb_meta['artwork_url']
                    
                    # Guardar MBIDs
                    metadata['musicbrainz_track_id'] = mb_meta.get('musicbrainz_track_id', '')
                    metadata['musicbrainz_album_id'] = mb_meta.get('musicbrainz_album_id', '')
                    metadata['musicbrainz_artist_id'] = mb_meta.get('musicbrainz_artist_id', '')
                    metadata['musicbrainz_albumartist_id'] = mb_meta.get('musicbrainz_albumartist_id', '')
                    metadata['musicbrainz_releasegroup_id'] = mb_meta.get('musicbrainz_releasegroup_id', '')
                    metadata['musicbrainz_releasetrack_id'] = mb_meta.get('musicbrainz_releasetrack_id', '')
                    
                    # Guardar campos nuevos
                    for key in [
                        'album_artist', 'track_number', 'track_total', 'disc_number', 'disc_total', 
                        'catalog_number', 'label', 'barcode', 'media', 'release_status', 'release_type', 
                        'release_country', 'release_script', 'artist_sort', 'albumartist_sort', 'isrc'
                    ]:
                        if mb_meta.get(key):
                            metadata[key] = mb_meta[key]
                    
                    if mb_meta.get('genres'):
                        genres_found.extend(mb_meta['genres'])
                    acoustid_success = True
                    logger.info(f"Identificación por huella AcoustID exitosa: {mb_meta['artist']} - {mb_meta['title']}")

        # 3. Si AcoustID falló o no coincide, hacemos fallback a texto en MusicBrainz
        if not acoustid_success:
            album_q = metadata.get('album', '')
            mb_resolved = False
            try:
                # Limpiar el título y el artista para mejorar la coincidencia en MusicBrainz
                clean_title = clean_title_for_query(title_q)
                clean_artist = clean_artist_for_query(artist_q)
                
                # Buscar por texto en MusicBrainz primero para conseguir toda la metadata rica
                query = f'artist:"{clean_artist}" AND recording:"{clean_title}"'
                if album_q and album_q != 'Unknown Album':
                    query += f' AND release:"{album_q}"'
                
                res = musicbrainzngs.search_recordings(query=query, limit=1)
                
                # Fallback sin álbum
                if not res.get('recording-list'):
                    res = musicbrainzngs.search_recordings(artist=clean_artist, recording=clean_title, limit=1)
                    
                # Fallback sin artista (sólo grabación + álbum limpio si el álbum es conocido)
                if not res.get('recording-list') and album_q and album_q != 'Unknown Album':
                    clean_album = clean_title_for_query(album_q)
                    if clean_album.lower().startswith('album - '):
                        clean_album = clean_album[8:].strip()
                    query_no_artist = f'recording:"{clean_title}" AND release:"{clean_album}"'
                    res = musicbrainzngs.search_recordings(query=query_no_artist, limit=1)
                    
                # Fallback con título/artista original
                if not res.get('recording-list'):
                    query_orig = f'artist:"{artist_q}" AND recording:"{title_q}"'
                    if album_q and album_q != 'Unknown Album':
                        query_orig += f' AND release:"{album_q}"'
                    res = musicbrainzngs.search_recordings(query=query_orig, limit=1)
                    
                if not res.get('recording-list'):
                    res = musicbrainzngs.search_recordings(artist=artist_q, recording=title_q, limit=1)
                
                if res and res.get('recording-list'):
                    mb_id = res['recording-list'][0]['id']
                    mb_meta = fetch_from_musicbrainz_id(mb_id)
                    if mb_meta:
                        metadata['artist'] = mb_meta['artist']
                        metadata['title'] = mb_meta['title']
                        metadata['album'] = mb_meta['album']
                        if mb_meta.get('year'):
                            metadata['year'] = mb_meta['year']
                        if mb_meta.get('original_date'):
                            metadata['original_date'] = mb_meta['original_date']
                        if mb_meta.get('artwork_url'):
                            metadata['artwork_url'] = mb_meta['artwork_url']
                        
                        # Guardar MBIDs
                        metadata['musicbrainz_track_id'] = mb_meta.get('musicbrainz_track_id', '')
                        metadata['musicbrainz_album_id'] = mb_meta.get('musicbrainz_album_id', '')
                        metadata['musicbrainz_artist_id'] = mb_meta.get('musicbrainz_artist_id', '')
                        metadata['musicbrainz_albumartist_id'] = mb_meta.get('musicbrainz_albumartist_id', '')
                        metadata['musicbrainz_releasegroup_id'] = mb_meta.get('musicbrainz_releasegroup_id', '')
                        metadata['musicbrainz_releasetrack_id'] = mb_meta.get('musicbrainz_releasetrack_id', '')
                        
                        # Guardar campos nuevos
                        for key in [
                            'album_artist', 'track_number', 'track_total', 'disc_number', 'disc_total', 
                            'catalog_number', 'label', 'barcode', 'media', 'release_status', 'release_type', 
                            'release_country', 'release_script', 'artist_sort', 'albumartist_sort', 'isrc'
                        ]:
                            if mb_meta.get(key):
                                metadata[key] = mb_meta[key]
                        
                        if mb_meta.get('genres'):
                            genres_found.extend(mb_meta['genres'])
                        mb_resolved = True
                        logger.info(f"MusicBrainz text-search exitoso: {mb_meta['artist']} - {mb_meta['title']}")
            except Exception as e:
                logger.error(f"Error en fallback de texto de MusicBrainz: {e}")
                
            # Si tampoco resolvió MusicBrainz por texto, nos quedamos con la metadata de iTunes/Deezer ya cargada
            if not mb_resolved:
                if itunes.get('title'):
                    metadata['artist'] = clean_and_romaji(itunes['artist'])
                    metadata['title'] = clean_and_romaji(itunes['title'])
                    metadata['album'] = clean_and_romaji(itunes['album'])
                elif deezer.get('title'):
                    metadata['artist'] = clean_and_romaji(deezer['artist'])
                    metadata['title'] = clean_and_romaji(deezer['title'])
                    metadata['album'] = clean_and_romaji(deezer['album'])

        return MediaProcessor.classify_genre_from_metadata(metadata, genres_found)

    @staticmethod
    def classify_genre_from_metadata(metadata: dict, genres_found: list) -> str:
        """Determina la carpeta de género adecuada basándose en los géneros e inyecta el tag all_genres."""
        seen_genres = set()
        unique_genres = []
        
        # Calcular década automáticamente (Plugin Decade de Picard)
        date_for_decade = metadata.get('original_date') or metadata.get('year') or metadata.get('release_date')
        if date_for_decade:
            decade_str = get_decade_string(str(date_for_decade))
            if decade_str:
                seen_genres.add(decade_str.lower())
                unique_genres.append(decade_str)
                
        for g in genres_found:
            if g:
                g_title = g.title().strip()
                if g_title.lower() not in seen_genres:
                    seen_genres.add(g_title.lower())
                    unique_genres.append(g_title)
                    
        metadata['all_genres'] = "; ".join(sorted(unique_genres))

        # Unir para evaluar el clasificador local de carpetas
        classification_tags = [g.lower() for g in unique_genres] + [t.lower() for t in metadata.get('raw_tags', [])]

        # Evaluar el Embudo de decisión de tu servidor
        if any(kw in g for g in classification_tags for kw in ["anime", "j-pop", "j-rock", "japanese", "vocaloid"]):
            return "J-Music"

        for target_folder, keywords in GENRE_MAPPING.items():
            if any(kw in g for g in classification_tags for kw in keywords):
                return target_folder

        return "General"

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

        genre_val = metadata.get('all_genres') or metadata.get('genre', 'General')

        try:
            if ext == "m4a":
                audio = MP4(filepath)
                audio["\xa9nam"] = [metadata['title']]
                audio["\xa9ART"] = [metadata['artist']]
                audio["\xa9alb"] = [metadata['album']]
                audio["\xa9gen"] = [genre_val]
                
                # Artista del álbum (aART)
                if metadata.get('album_artist'):
                    audio["aART"] = [metadata['album_artist']]
                elif metadata.get('artist'):
                    audio["aART"] = [metadata['artist']]
                
                # Artistas (ARTISTS)
                audio['----:com.apple.iTunes:ARTISTS'] = [(metadata.get('album_artist') or metadata['artist']).encode('utf-8')]
                
                # Número de pista y total de pistas (trkn)
                track_val = int(metadata.get('track_number') or 1)
                track_tot = int(metadata.get('track_total') or metadata.get('total_tracks') or 0)
                audio["trkn"] = [(track_val, track_tot)]
                
                # Número de disco y total de discos (disk)
                disc_val = int(metadata.get('disc_number') or 1)
                disc_tot = int(metadata.get('disc_total') or 1)
                audio["disk"] = [(disc_val, disc_tot)]
                
                if metadata.get('lyrics'):
                    audio["\xa9lyr"] = [metadata['lyrics']]
                
                # Comentario y URL de descarga
                if metadata.get('webpage_url'):
                    audio["\xa9cmt"] = [f"Downloaded from YouTube: {metadata['webpage_url']}"]
                
                # Fecha de lanzamiento específica / año
                date_val = metadata.get('year') or metadata.get('original_date') or metadata.get('release_date')
                if date_val:
                    audio["\xa9day"] = [str(date_val)]
                
                # Año original / fecha original de publicación (Picard)
                if metadata.get('original_date'):
                    orig_str = str(metadata['original_date'])
                    audio['----:com.apple.iTunes:originaldate'] = [orig_str.encode('utf-8')]
                    orig_year = orig_str.split('-')[0]
                    audio['----:com.apple.iTunes:ORIGINALYEAR'] = [orig_year.encode('utf-8')]
                
                # Inyectar atoms de MusicBrainz (MBIDs) y original date
                if metadata.get('musicbrainz_track_id'):
                    audio['----:com.apple.iTunes:MusicBrainz Track Id'] = [metadata['musicbrainz_track_id'].encode('utf-8')]
                    audio['----:com.apple.iTunes:MusicBrainz Recording Id'] = [metadata['musicbrainz_track_id'].encode('utf-8')]
                if metadata.get('musicbrainz_releasetrack_id'):
                    audio['----:com.apple.iTunes:MusicBrainz Release Track Id'] = [metadata['musicbrainz_releasetrack_id'].encode('utf-8')]
                if metadata.get('musicbrainz_album_id'):
                    audio['----:com.apple.iTunes:MusicBrainz Album Id'] = [metadata['musicbrainz_album_id'].encode('utf-8')]
                if metadata.get('musicbrainz_artist_id'):
                    audio['----:com.apple.iTunes:MusicBrainz Artist Id'] = [metadata['musicbrainz_artist_id'].encode('utf-8')]
                if metadata.get('musicbrainz_albumartist_id'):
                    audio['----:com.apple.iTunes:MusicBrainz Album Artist Id'] = [metadata['musicbrainz_albumartist_id'].encode('utf-8')]
                if metadata.get('musicbrainz_releasegroup_id'):
                    audio['----:com.apple.iTunes:MusicBrainz Release Group Id'] = [metadata['musicbrainz_releasegroup_id'].encode('utf-8')]
                if metadata.get('acoustid_id'):
                    audio['----:com.apple.iTunes:Acoustid Id'] = [metadata['acoustid_id'].encode('utf-8')]
                
                # Campos adicionales de Picard
                if metadata.get('catalog_number'):
                    audio['----:com.apple.iTunes:CATALOGNUMBER'] = [metadata['catalog_number'].encode('utf-8')]
                if metadata.get('label'):
                    audio['----:com.apple.iTunes:LABEL'] = [metadata['label'].encode('utf-8')]
                if metadata.get('barcode'):
                    audio['----:com.apple.iTunes:BARCODE'] = [metadata['barcode'].encode('utf-8')]
                if metadata.get('media'):
                    audio['----:com.apple.iTunes:MEDIA'] = [metadata['media'].encode('utf-8')]
                
                # Campos adicionales de Picard de estado y tipo
                if metadata.get('release_status'):
                    audio['----:com.apple.iTunes:MusicBrainz Album Status'] = [metadata['release_status'].encode('utf-8')]
                    audio['----:com.apple.iTunes:RELEASESTATUS'] = [metadata['release_status'].encode('utf-8')]
                if metadata.get('release_type'):
                    audio['----:com.apple.iTunes:MusicBrainz Album Type'] = [metadata['release_type'].encode('utf-8')]
                    audio['----:com.apple.iTunes:RELEASETYPE'] = [metadata['release_type'].encode('utf-8')]
                if metadata.get('release_country'):
                    audio['----:com.apple.iTunes:MusicBrainz Album Release Country'] = [metadata['release_country'].encode('utf-8')]
                    audio['----:com.apple.iTunes:RELEASECOUNTRY'] = [metadata['release_country'].encode('utf-8')]
                if metadata.get('release_script'):
                    audio['----:com.apple.iTunes:MusicBrainz Album Script'] = [metadata['release_script'].encode('utf-8')]
                    audio['----:com.apple.iTunes:SCRIPT'] = [metadata['release_script'].encode('utf-8')]
                if metadata.get('isrc'):
                    audio['----:com.apple.iTunes:ISRC'] = [metadata['isrc'].encode('utf-8')]
                
                # Tags de ordenación (Sort Tags)
                audio['soar'] = [metadata.get('artist_sort') or metadata['artist']]
                audio['----:com.apple.iTunes:ARTISTSORT'] = [(metadata.get('artist_sort') or metadata['artist']).encode('utf-8')]
                audio['soaa'] = [metadata.get('albumartist_sort') or metadata.get('album_artist') or metadata['artist']]
                audio['----:com.apple.iTunes:ALBUMARTISTSORT'] = [(metadata.get('albumartist_sort') or metadata.get('album_artist') or metadata['artist']).encode('utf-8')]
                audio['soal'] = [metadata['album']]
                audio['----:com.apple.iTunes:ALBUMSORT'] = [metadata['album'].encode('utf-8')]
                audio['sonm'] = [metadata['title']]
                audio['----:com.apple.iTunes:TITLESORT'] = [metadata['title'].encode('utf-8')]
                
                if artwork_bytes:
                    audio["covr"] = [MP4Cover(artwork_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
                
                audio.save()
                make_writable(filepath)

            elif ext == "mp3":
                audio = MP3(filepath, ID3=ID3)
                if audio.tags is None:
                    audio.add_tags()
                audio.tags.add(TIT2(encoding=3, text=metadata['title']))
                audio.tags.add(TPE1(encoding=3, text=metadata['artist']))
                audio.tags.add(TALB(encoding=3, text=metadata['album']))
                audio.tags.add(TCON(encoding=3, text=genre_val))
                
                # Artista del álbum (TPE2)
                if metadata.get('album_artist'):
                    audio.tags.add(TPE2(encoding=3, text=metadata['album_artist']))
                elif metadata.get('artist'):
                    audio.tags.add(TPE2(encoding=3, text=metadata['artist']))
                
                # Artistas (TXXX:ARTISTS)
                audio.tags.add(TXXX(encoding=3, desc='ARTISTS', text=[metadata.get('album_artist') or metadata['artist']]))
                
                # Número de pista y total de pistas (TRCK)
                track_no = str(metadata.get('track_number') or '1')
                track_tot = metadata.get('track_total') or metadata.get('total_tracks')
                track_str = f"{track_no}/{track_tot}" if track_tot else track_no
                audio.tags.add(TRCK(encoding=3, text=track_str))
                
                # Número de disco y total de discos (TPOS)
                disc_no = str(metadata.get('disc_number') or '1')
                disc_tot = metadata.get('disc_total')
                disc_str = f"{disc_no}/{disc_tot}" if disc_tot else disc_no
                audio.tags.add(TPOS(encoding=3, text=disc_str))
                
                if metadata.get('lyrics'):
                    audio.tags.add(USLT(encoding=3, lang='eng', desc='Lyrics', text=metadata['lyrics']))
                
                # Comentario y URL de descarga (COMM y WXXX)
                if metadata.get('webpage_url'):
                    audio.tags.add(WXXX(encoding=3, desc='download_url', url=metadata['webpage_url']))
                    comment_text = f"Downloaded from YouTube: {metadata['webpage_url']}"
                    audio.tags.add(COMM(encoding=3, lang='eng', desc='Comment', text=[comment_text]))
                
                # Fecha de lanzamiento específica / año (TDRC)
                date_val = metadata.get('year') or metadata.get('original_date') or metadata.get('release_date')
                if date_val:
                    audio.tags.add(TDRC(encoding=3, text=str(date_val)))
                
                # Año original (TDOR y TORY)
                if metadata.get('original_date'):
                    orig_str = str(metadata['original_date'])
                    audio.tags.add(TDOR(encoding=3, text=[orig_str]))
                    orig_year = orig_str.split('-')[0]
                    audio.tags.add(TXXX(encoding=3, desc='ORIGINALYEAR', text=[orig_year]))
                    try:
                        from mutagen.id3 import TORY
                        audio.tags.add(TORY(encoding=3, text=[orig_year]))
                    except:
                        pass
                
                # Inyectar frames TXXX de MusicBrainz (MBIDs) y UFID
                if metadata.get('musicbrainz_track_id'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Track Id', text=[metadata['musicbrainz_track_id']]))
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Recording Id', text=[metadata['musicbrainz_track_id']]))
                    audio.tags.add(UFID(owner="http://musicbrainz.org", data=metadata['musicbrainz_track_id'].encode('utf-8')))
                if metadata.get('musicbrainz_releasetrack_id'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Release Track Id', text=[metadata['musicbrainz_releasetrack_id']]))
                if metadata.get('musicbrainz_album_id'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Album Id', text=[metadata['musicbrainz_album_id']]))
                if metadata.get('musicbrainz_artist_id'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Artist Id', text=[metadata['musicbrainz_artist_id']]))
                if metadata.get('musicbrainz_albumartist_id'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Album Artist Id', text=[metadata['musicbrainz_albumartist_id']]))
                if metadata.get('musicbrainz_releasegroup_id'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Release Group Id', text=[metadata['musicbrainz_releasegroup_id']]))
                if metadata.get('acoustid_id'):
                    audio.tags.add(TXXX(encoding=3, desc='Acoustid Id', text=[metadata['acoustid_id']]))
                
                # Campos adicionales de Picard
                if metadata.get('label'):
                    audio.tags.add(TPUB(encoding=3, text=metadata['label']))
                if metadata.get('media'):
                    audio.tags.add(TMED(encoding=3, text=metadata['media']))
                if metadata.get('catalog_number'):
                    audio.tags.add(TXXX(encoding=3, desc='Catalog Number', text=[metadata['catalog_number']]))
                    audio.tags.add(TXXX(encoding=3, desc='CATALOGNUMBER', text=[metadata['catalog_number']]))
                if metadata.get('barcode'):
                    audio.tags.add(TXXX(encoding=3, desc='Barcode', text=[metadata['barcode']]))
                    audio.tags.add(TXXX(encoding=3, desc='BARCODE', text=[metadata['barcode']]))
                
                # Campos adicionales de Picard de estado y tipo
                if metadata.get('release_status'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Album Status', text=[metadata['release_status']]))
                    audio.tags.add(TXXX(encoding=3, desc='RELEASESTATUS', text=[metadata['release_status']]))
                if metadata.get('release_type'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Album Type', text=[metadata['release_type']]))
                    audio.tags.add(TXXX(encoding=3, desc='RELEASETYPE', text=[metadata['release_type']]))
                if metadata.get('release_country'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Album Release Country', text=[metadata['release_country']]))
                    audio.tags.add(TXXX(encoding=3, desc='RELEASECOUNTRY', text=[metadata['release_country']]))
                if metadata.get('release_script'):
                    audio.tags.add(TXXX(encoding=3, desc='MusicBrainz Album Script', text=[metadata['release_script']]))
                    audio.tags.add(TXXX(encoding=3, desc='SCRIPT', text=[metadata['release_script']]))
                if metadata.get('isrc'):
                    audio.tags.add(TSRC(encoding=3, text=metadata['isrc']))
                    audio.tags.add(TXXX(encoding=3, desc='ISRC', text=[metadata['isrc']]))
                
                # Tags de ordenación (Sort Tags)
                art_sort = metadata.get('artist_sort') or metadata['artist']
                audio.tags.add(TSOP(encoding=3, text=art_sort))
                audio.tags.add(TXXX(encoding=3, desc='ARTISTSORT', text=[art_sort]))
                
                alb_art_sort = metadata.get('albumartist_sort') or metadata.get('album_artist') or metadata['artist']
                audio.tags.add(TSO2(encoding=3, text=alb_art_sort))
                audio.tags.add(TXXX(encoding=3, desc='ALBUMARTISTSORT', text=[alb_art_sort]))
                
                alb_sort = metadata['album']
                audio.tags.add(TSOA(encoding=3, text=alb_sort))
                audio.tags.add(TXXX(encoding=3, desc='ALBUMSORT', text=[alb_sort]))
                
                tit_sort = metadata['title']
                audio.tags.add(TSOT(encoding=3, text=tit_sort))
                audio.tags.add(TXXX(encoding=3, desc='TITLESORT', text=[tit_sort]))
                
                if artwork_bytes:
                    audio.tags.add(APIC(
                        encoding=3,
                        mime='image/jpeg',
                        type=3,
                        desc='Front Cover',
                        data=artwork_bytes
                    ))
                audio.save()
                make_writable(filepath)
        except Exception as e:
            logger.error(f"Error escribiendo tags ({ext}): {e}")
            raise e

    @staticmethod
    def move_to_library(filepath: str, metadata: dict) -> str:
        """Ubica el archivo físicamente en el disco según tu jerarquía organizativa."""
        album_artist = (metadata.get('album_artist') or metadata['artist']).replace('/', '_').replace(':', '-')
        album = metadata['album'].replace('/', '_').replace(':', '-')
        title = metadata['title'].replace('/', '_').replace(':', '-')
        
        track_val = metadata.get('track_number', '1')
        try:
            track_no = f"{int(track_val):02d}"
        except:
            track_no = str(track_val)

        ext = filepath.split('.')[-1]

        year = metadata.get('year', '')
        album_folder = f"[{year}] - {album}" if year else album

        is_comp = bool(metadata.get('is_compilation'))
        if not is_comp:
            art_lower = album_artist.lower()
            if "various artists" in art_lower or "varios artistas" in art_lower or art_lower in ["varios", "various"]:
                is_comp = True

        if metadata.get('is_soundtrack'):
            final_dir = os.path.join(_music_dir, "Soundtracks", album_folder)
        elif is_comp:
            final_dir = os.path.join(_music_dir, "Compilaciones", album_folder)
        else:
            folder = metadata.get('genre', 'General')
            if folder == "General-Music":
                folder = "General"
            final_dir = os.path.join(_music_dir, folder, album_artist, album_folder)

        os.makedirs(final_dir, exist_ok=True)
        make_writable(final_dir)
        final_path = os.path.join(final_dir, f"{track_no} - {title}.{ext}")
        shutil.move(filepath, final_path)
        make_writable(final_path)
        return final_path


def cleanup_temp_dir():
    """Elimina archivos en TEMP_DIR con más de 24 horas de antigüedad para evitar acumulación."""
    import time
    if not os.path.exists(TEMP_DIR):
        return
    logger.info(f"Iniciando limpieza de archivos temporales antiguos en: {TEMP_DIR}")
    now = time.time()
    cutoff = now - 24 * 3600  # 24 horas
    count = 0
    for filename in os.listdir(TEMP_DIR):
        filepath = os.path.join(TEMP_DIR, filename)
        if os.path.isfile(filepath):
            try:
                mtime = os.path.getmtime(filepath)
                if mtime < cutoff:
                    os.remove(filepath)
                    count += 1
            except Exception as e:
                logger.warning(f"No se pudo eliminar archivo temporal {filepath}: {e}")
    if count > 0:
        logger.info(f"Limpieza completada. Se eliminaron {count} archivos obsoletos.")


# =========================================================================
# CLI INTERFACE FOR SPAWNING FROM NODE.JS
# =========================================================================
if __name__ == "__main__":
    cleanup_temp_dir()

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
        force_type = sys.argv[4] if len(sys.argv) > 4 else None
        chosen_release_id = sys.argv[5] if len(sys.argv) > 5 else None
        try:
            result = MediaProcessor.download_audio(url, task_id, force_type, chosen_release_id)
            
            if result.get("is_playlist"):
                tracks = result["tracks"]
                genres_suggested = []
                artwork_cache = {}
                
                release_info = {}
                
                # 1. Si el usuario ya eligió una versión
                if chosen_release_id:
                    if chosen_release_id != "none":
                        try:
                            logger.info(f"Cargando release seleccionada por el usuario: {chosen_release_id}")
                            release_info = musicbrainzngs.get_release_by_id(
                                chosen_release_id,
                                includes=["recordings", "artists", "labels", "release-groups", "tags", "media"]
                            ).get("release", {})
                        except Exception as ree:
                            logger.error(f"Error cargando release {chosen_release_id}: {ree}")
                else:
                    # 2. Búsqueda por texto en MusicBrainz (Prioridad Alta)
                    if not result.get("is_custom_playlist"):
                        logger.info("Buscando release en MusicBrainz usando búsqueda textual...")
                        release_info = resolve_album_release_level(result["playlist_title"], result["playlist_artist"], len(tracks))
                    
                    # 3. Si no se encontró por texto, obtener candidatos y preguntar si hay múltiples
                    if not release_info and not result.get("is_custom_playlist"):
                        logger.info("No se encontró release exacta. Buscando candidatos para presentar al usuario...")
                        candidates = search_album_candidates(result["playlist_title"], result["playlist_artist"])
                        if candidates:
                            # Auto-seleccionar solo si hay único candidato con pistas Y artista coincidentes (Spec §3)
                            auto_select = False
                            if len(candidates) == 1 and abs(candidates[0]["tracks"] - len(tracks)) <= 1:
                                c_art = normalize_string_for_matching(candidates[0]["artist"])
                                p_art = normalize_string_for_matching(result["playlist_artist"])
                                auto_select = not c_art or not p_art or c_art in p_art or p_art in c_art
                                if not auto_select:
                                    logger.info(f"Candidato único rechazado por artista no coincidente: MB='{candidates[0]['artist']}' vs YT='{result['playlist_artist']}'")
                            
                            if auto_select:
                                try:
                                    logger.info(f"Auto-seleccionado candidato único exacto: {candidates[0]['id']}")
                                    release_info = musicbrainzngs.get_release_by_id(
                                        candidates[0]['id'],
                                        includes=["recordings", "artists", "labels", "release-groups", "tags", "media"]
                                    ).get("release", {})
                                except Exception as ree:
                                    logger.error(f"Error cargando release única {candidates[0]['id']}: {ree}")
                            else:
                                # Múltiples candidatos o artista no coincide — presentar lista al usuario
                                print(json.dumps({
                                    "success": True,
                                    "is_playlist": True,
                                    "playlist_title": result["playlist_title"],
                                    "playlist_artist": result["playlist_artist"],
                                    "candidates": candidates,
                                    "tracks": tracks
                                }))
                                sys.exit(0)

                # Si pudimos resolver el álbum completo, re-mapeamos todos los tracks
                if release_info:
                    logger.info("Remapeando tracks usando la release oficial del álbum...")
                    for idx, t in enumerate(tracks):
                        try:
                            # Guardar la carátula original de YouTube Music como respaldo
                            if 'artwork_url' in t and t['artwork_url']:
                                t['yt_artwork_url'] = t['artwork_url']
                                
                            t_num = int(t.get('track_number') or (idx + 1))
                            mb_meta = map_release_track_to_metadata(release_info, t_num, len(tracks))
                            if mb_meta:
                                for k, v in mb_meta.items():
                                    if v:
                                        t[k] = v
                                # Recalcular el género sugerido con la nueva metadata
                                t['genre'] = MediaProcessor.classify_genre_from_metadata(t, mb_meta.get('genres', []))
                        except Exception as me:
                            logger.error(f"Error mapeando track {t.get('title')} a la release: {me}")
                else:
                    # Usar los metadatos de YouTube Music directamente
                    logger.info("Usando metadatos de YouTube Music directamente sin MusicBrainz.")
                    # Para álbumes sin release de MB, no usar AcoustID (lento y poco fiable por track)
                    _skip_acoustid = not result.get("is_custom_playlist", False)
                    for t in tracks:
                        sug_genre = MediaProcessor.fetch_genre_multi_provider(t, is_album_track=_skip_acoustid)
                        t['genre'] = sug_genre
                
                # Cargar letras y agregar a la lista de géneros sugeridos
                for t in tracks:
                    genres_suggested.append(t['genre'])
                    lyrics = fetch_lyrics_from_lrclib(t['artist'], t['title'])
                    t['lyrics'] = lyrics
                
                # Descargar carátulas individuales usando caché de álbum original
                for t in tracks:
                    art_url = t.get('artwork_url')
                    yt_url = t.get('yt_artwork_url')
                    
                    album_key = t.get('album', '') or 'Unknown Album'
                    if album_key in artwork_cache:
                        t['artwork_path'] = artwork_cache[album_key]
                    else:
                        art_path = None
                        # 1. Intentar con la carátula oficial de MusicBrainz
                        if art_url:
                            logger.info(f"Intentando descargar carátula oficial de MusicBrainz: {art_url}")
                            art_path = download_artwork(art_url, f"{task_id}_{len(artwork_cache)}")
                            
                        # 2. Fallback: usar la carátula de YouTube Music original
                        if not art_path and yt_url:
                            logger.info(f"Carátula oficial falló o no existe. Usando carátula de respaldo de YouTube: {yt_url}")
                            art_path = download_artwork(yt_url, f"{task_id}_{len(artwork_cache)}")
                            
                        if art_path:
                            t['artwork_path'] = art_path
                            artwork_cache[album_key] = art_path
                
                if genres_suggested:
                    from collections import Counter
                    most_common = Counter(genres_suggested).most_common(1)
                    suggested_global_genre = most_common[0][0] if most_common else "General"
                else:
                    suggested_global_genre = "General"
                
                tracks_with_artwork = sum(1 for t in tracks if t.get('artwork_path'))
                tracks_with_lyrics = sum(1 for t in tracks if t.get('lyrics'))
                
                print(json.dumps({
                    "success": True,
                    "is_playlist": True,
                    "playlist_title": result["playlist_title"],
                    "playlist_artist": result["playlist_artist"],
                    "genre": suggested_global_genre,
                    "tracks_with_artwork": tracks_with_artwork,
                    "tracks_with_lyrics": tracks_with_lyrics,
                    "tracks": tracks
                }))
            else:
                metadata = result
                suggested_genre = MediaProcessor.fetch_genre_multi_provider(metadata)
                metadata['genre'] = suggested_genre
                
                lyrics = fetch_lyrics_from_lrclib(metadata['artist'], metadata['title'])
                metadata['lyrics'] = lyrics
                
                if metadata.get('artwork_url'):
                    art_path = download_artwork(metadata['artwork_url'], task_id)
                    if art_path:
                        metadata['artwork_path'] = art_path
                
                print(json.dumps({
                    "success": True,
                    "is_playlist": False,
                    "metadata": metadata
                }))
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
            
            if metadata.get("is_playlist"):
                tracks = metadata.get("tracks", [])
                genre = metadata.get("genre", "General")
                is_album_mode = metadata.get("is_album_mode", True)
                
                # Si está activado el modo Álbum, homogeneizar los tracks antes de guardar y mover
                if is_album_mode:
                    artists_list = [t.get('artist') for t in tracks if t.get('artist') and t.get('artist') != 'Unknown Artist']
                    albums_list = [t.get('album') for t in tracks if t.get('album') and t.get('album') != 'Unknown Album']
                    years_list = [t.get('year') for t in tracks if t.get('year')]
                    
                    # Detectar si alguna pista del álbum es soundtrack o compilación (Spec §14)
                    any_soundtrack = any(t.get('is_soundtrack') for t in tracks)
                    any_compilation = any(t.get('is_compilation') for t in tracks)
                    
                    majority_artist = None
                    majority_album = metadata.get("playlist_title") or "Unknown Album"
                    majority_year = ""
                    majority_mb_album_id = ""
                    majority_mb_artist_id = ""
                    majority_mb_albumartist_id = ""
                    majority_mb_releasegroup_id = ""
                    majority_artwork_path = ""
                    
                    majority_album_artist = ""
                    majority_catalog_number = ""
                    majority_label = ""
                    majority_barcode = ""
                    majority_media = ""
                    majority_disc_total = 1
                    
                    from collections import Counter
                    
                    # Contar los album_artists y artists de los tracks para ver si hay uno resuelto y válido
                    album_artists_list = [t.get('album_artist') for t in tracks if t.get('album_artist') and t.get('album_artist') != 'Unknown Artist']
                    if album_artists_list:
                        aa_counter = Counter(album_artists_list).most_common(1)
                        majority_album_artist = aa_counter[0][0]
                    
                    if artists_list:
                        art_counter = Counter(artists_list).most_common(1)
                        if art_counter[0][1] >= len(artists_list) * 0.4:
                            majority_artist = art_counter[0][0]
                            if not majority_album_artist:
                                majority_album_artist = majority_artist
                    
                    if albums_list:
                        alb_counter = Counter(albums_list).most_common(1)
                        if alb_counter[0][1] >= len(albums_list) * 0.4:
                            majority_album = alb_counter[0][0]
                    
                    if years_list:
                        yr_counter = Counter(years_list).most_common(1)
                        majority_year = yr_counter[0][0]
                    
                    # Buscar la carátula y MBIDs del álbum mayoritario
                    for t in tracks:
                        if t.get('album') == majority_album:
                            if t.get('artwork_path'):
                                majority_artwork_path = t['artwork_path']
                            if t.get('musicbrainz_album_id'):
                                majority_mb_album_id = t['musicbrainz_album_id']
                                majority_mb_albumartist_id = t.get('musicbrainz_albumartist_id', '')
                                majority_mb_releasegroup_id = t.get('musicbrainz_releasegroup_id', '')
                                if t.get('artist') == majority_artist:
                                    majority_mb_artist_id = t.get('musicbrainz_artist_id', '')
                            
                            # Cargar campos mayoritarios adicionales
                            if t.get('album_artist') and not majority_album_artist:
                                majority_album_artist = t['album_artist']
                            if t.get('catalog_number'):
                                majority_catalog_number = t['catalog_number']
                            if t.get('label'):
                                majority_label = t['label']
                            if t.get('barcode'):
                                majority_barcode = t['barcode']
                            if t.get('media'):
                                majority_media = t['media']
                            if t.get('disc_total'):
                                majority_disc_total = t['disc_total']
                    
                    if not majority_artwork_path:
                        for t in tracks:
                            if t.get('artwork_path'):
                                majority_artwork_path = t['artwork_path']
                                break
                                
                    if not majority_mb_albumartist_id and majority_mb_artist_id:
                        majority_mb_albumartist_id = majority_mb_artist_id
                    
                    if not majority_album_artist and majority_artist:
                        majority_album_artist = majority_artist
                    
                    if not majority_album_artist:
                        majority_album_artist = metadata.get("playlist_artist") or "Unknown Artist"
                    
                    logger.info(f"Finalize: Homogeneizando tracks de album. Artista Principal: '{majority_artist or majority_album_artist}', Álbum: '{majority_album}'")
                    for t in tracks:
                        if majority_artwork_path:
                            t['artwork_path'] = majority_artwork_path
                        
                        t['album'] = majority_album
                        if majority_year:
                            t['year'] = majority_year
                        if majority_mb_album_id:
                            t['musicbrainz_album_id'] = majority_mb_album_id
                        if majority_mb_albumartist_id:
                            t['musicbrainz_albumartist_id'] = majority_mb_albumartist_id
                        if majority_mb_releasegroup_id:
                            t['musicbrainz_releasegroup_id'] = majority_mb_releasegroup_id
                        
                        # Asignar siempre el album_artist de la release/playlist
                        t['album_artist'] = majority_album_artist
                        
                        if majority_catalog_number:
                            t['catalog_number'] = majority_catalog_number
                        if majority_label:
                            t['label'] = majority_label
                        if majority_barcode:
                            t['barcode'] = majority_barcode
                        if majority_media:
                            t['media'] = majority_media
                        if majority_disc_total:
                            t['disc_total'] = majority_disc_total
                            
                        # Si no hay un artista de track mayoritario claro, conservar artista individual
                        if majority_artist and t.get('artist') != majority_artist:
                            t['artist'] = majority_artist
                            if majority_mb_artist_id:
                                t['musicbrainz_artist_id'] = majority_mb_artist_id
                        # Propagar is_soundtrack e is_compilation a todos los tracks del álbum (Spec §14)
                        if any_soundtrack:
                            t['is_soundtrack'] = True
                        if any_compilation:
                            t['is_compilation'] = True

                final_paths = []
                artwork_paths_to_clean = set()
                
                for t in tracks:
                    if t.get("already_exists"):
                        final_paths.append(t['filepath'])
                        continue
                    t['genre'] = genre
                    MediaProcessor.write_id3_tags(t['filepath'], t)
                    fpath = MediaProcessor.move_to_library(t['filepath'], t)
                    final_paths.append(fpath)
                    
                    if t.get('artwork_path'):
                        artwork_paths_to_clean.add(t['artwork_path'])
                
                # Guardar cover.jpg en la carpeta del álbum antes de limpiar temporales (Spec §4)
                if is_album_mode and majority_artwork_path and os.path.exists(majority_artwork_path) and final_paths:
                    album_dir = os.path.dirname(final_paths[0])
                    cover_dest = os.path.join(album_dir, "cover.jpg")
                    if not os.path.exists(cover_dest):
                        try:
                            shutil.copy2(majority_artwork_path, cover_dest)
                            make_writable(cover_dest)
                            logger.info(f"cover.jpg guardado en: {cover_dest}")
                        except Exception as ce:
                            logger.error(f"Error guardando cover.jpg: {ce}")
                
                for ap in artwork_paths_to_clean:
                    if os.path.exists(ap):
                        try:
                            os.remove(ap)
                        except:
                            pass
                
                # Si es una playlist personalizada, crear archivo M3U
                if metadata.get("is_custom_playlist"):
                    try:
                        playlists_dir = os.path.join(_music_dir, "Playlists")
                        os.makedirs(playlists_dir, exist_ok=True)
                        make_writable(playlists_dir)
                        
                        # Limpiar el nombre de la playlist para el archivo
                        safe_playlist_title = (metadata.get("playlist_title") or "Unnamed Playlist").replace('/', '_').replace(':', '-')
                        m3u_filepath = os.path.join(playlists_dir, f"{safe_playlist_title}.m3u")
                        
                        with open(m3u_filepath, "w", encoding="utf-8") as m3u_file:
                            m3u_file.write("#EXTM3U\n")
                            for fpath in final_paths:
                                # Escribir la ruta relativa desde la carpeta Playlists a la canción
                                rel_path = os.path.relpath(fpath, playlists_dir).replace('\\', '/')
                                m3u_file.write(f"{rel_path}\n")
                                
                        make_writable(m3u_filepath)
                        logger.info(f"Playlist M3U creada con éxito en: {m3u_filepath}")
                    except Exception as pe:
                        logger.error(f"Error creando playlist M3U: {pe}")
 

                
                album_dir = os.path.dirname(final_paths[0]) if final_paths else "M:\\music"
                print(json.dumps({
                    "success": True, 
                    "final_path": album_dir,
                    "playlist_completed": True,
                    "tracks_count": len(final_paths)
                }))
            else:
                if metadata.get("already_exists"):
                    final_path = filepath
                else:
                    MediaProcessor.write_id3_tags(filepath, metadata)
                    final_path = MediaProcessor.move_to_library(filepath, metadata)
                
                if metadata.get('artwork_path') and os.path.exists(metadata['artwork_path']):
                    # Guardar cover.jpg junto a la canción (Spec §4)
                    cover_dest = os.path.join(os.path.dirname(final_path), "cover.jpg")
                    if not os.path.exists(cover_dest):
                        try:
                            shutil.copy2(metadata['artwork_path'], cover_dest)
                            make_writable(cover_dest)
                        except Exception as ce:
                            logger.error(f"Error guardando cover.jpg para single: {ce}")
                    try:
                        os.remove(metadata['artwork_path'])
                    except:
                        pass
                

                    
                print(json.dumps({"success": True, "final_path": final_path}))
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)
            
    elif action == "enhance_acoustid":
        # Re-analiza con AcoustID los tracks ya descargados de una playlist personalizada (Spec §1.B)
        if len(sys.argv) < 3:
            print(json.dumps({"success": False, "error": "Missing metadata JSON"}))
            sys.exit(1)
        try:
            metadata = json.loads(sys.argv[2])
            tracks = metadata.get("tracks", [])
            genres_suggested = []
            for t in tracks:
                fp = t.get('filepath', '')
                if not t.get('already_exists') and fp and os.path.exists(fp):
                    sug_genre = MediaProcessor.fetch_genre_multi_provider(t, is_album_track=False)
                    t['genre'] = sug_genre
                genres_suggested.append(t.get('genre', 'General'))
            if genres_suggested:
                from collections import Counter
                most_common = Counter(genres_suggested).most_common(1)
                suggested_global_genre = most_common[0][0] if most_common else "General"
            else:
                suggested_global_genre = "General"
            print(json.dumps({
                "success": True,
                "is_playlist": True,
                "is_custom_playlist": True,
                "playlist_title": metadata.get("playlist_title"),
                "playlist_artist": metadata.get("playlist_artist"),
                "genre": suggested_global_genre,
                "tracks_with_artwork": sum(1 for t in tracks if t.get('artwork_path')),
                "tracks_with_lyrics": sum(1 for t in tracks if t.get('lyrics')),
                "tracks": tracks
            }))
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)

    else:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)

