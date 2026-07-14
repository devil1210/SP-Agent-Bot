import yt_dlp
ydl_opts = {
    'extract_flat': False,
    'quiet': True,
}
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info("https://music.youtube.com/playlist?list=OLAK5uy_l2HM_gI3U1p6AVG8gios3sfuH1Uch4xtM", download=False)
    print("Playlist Title:", info.get('title'))
    print("Playlist Uploader:", info.get('uploader'))
    entries = info.get('entries', [])
    if entries:
        first = entries[0]
        print("First track keys:", list(first.keys()))
        print("First track artist:", first.get('artist'))
        print("First track album:", first.get('album'))
        print("First track thumbnail:", first.get('thumbnail'))
