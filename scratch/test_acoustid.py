import os
import subprocess
import json
import requests

fpcalc_bin = r"e:\Descargas\SPbot\scripts\fpcalc.exe"
audio_file = r"M:\music\J-Music\Kobasoro Haru Cha\[2018] - Lemon (Kenshi Yonezu Cover)\01 - Lemon (Kenshi Yonezu Cover).m4a"

if not os.path.exists(fpcalc_bin):
    print("fpcalc not found at:", fpcalc_bin)
    exit(1)

if not os.path.exists(audio_file):
    print("audio file not found at:", audio_file)
    exit(1)

cmd = [fpcalc_bin, "-json", audio_file]
res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
data = json.loads(res.stdout)
duration = data.get("duration")
fingerprint = data.get("fingerprint")

print("Duration:", duration)

client_key = "8XaBELvH"
url = "https://api.acoustid.org/v2/lookup"
params = {
    "client": client_key,
    "meta": "recordings releasegroups releases",
    "duration": int(duration),
    "fingerprint": fingerprint
}

response = requests.get(url, params=params, timeout=8)
print("AcoustID Response status:", response.status_code)
acoust_data = response.json()
print("AcoustID Results count:", len(acoust_data.get("results", [])))
print(json.dumps(acoust_data, indent=2))
