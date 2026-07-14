import yt_dlp
import json

ydl_opts = {
    'extract_flat': False,
    'quiet': True,
}
url = "https://music.youtube.com/watch?v=SX_ViT4Ra7k&si=nKJ_n7zIH2MFkXCC"
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    # Print keys and some specific metadata fields
    print("KEYS:", list(info.keys()))
    print("TITLE:", info.get('title'))
    print("TRACK:", info.get('track'))
    print("ARTIST:", info.get('artist'))
    print("UPLOADER:", info.get('uploader'))
    print("CREATOR:", info.get('creator'))
    print("ALBUM:", info.get('album'))
    print("ALT_TITLE:", info.get('alt_title'))
