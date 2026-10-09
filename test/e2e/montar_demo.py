#!/usr/bin/env python3
"""Monta docs/demo.mp4 y docs/demo.gif a partir de la grabación de demo.js.

Los ratos en que Claude trabaja (marcas «espera»→«fin») van a 4x; el resto a 1,15x.
Uso: python3 test/e2e/montar_demo.py raw.mp4 marks.json carpeta_salida
"""
import json
import subprocess
import sys

raw, marks_path, out = sys.argv[1:4]
OFF = 1.1  # la grabación arranca ~1 s antes que el reloj de las marcas
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]))
m = json.load(open(marks_path))
segs, t = [], 0.8
for a, b in zip(m[::2], m[1::2]):
    ini, fin = a["t"] + OFF + 0.6, b["t"] + OFF - 1.2  # se ve el Enter y la respuesta final
    if ini > t:
        segs.append((t, ini, 1.15))
    if fin > ini:
        segs.append((ini, fin, 4.0))
    t = max(t, fin)
segs.append((t, dur, 1.15))
fc = ";".join(f"[0:v]trim={a:.2f}:{b:.2f},setpts=(PTS-STARTPTS)/{s},crop=1400:864:0:36[v{i}]" for i, (a, b, s) in enumerate(segs))
fc += ";" + "".join(f"[v{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0,tpad=stop_mode=clone:stop_duration=3[out]"
mp4, gif = f"{out}/demo.mp4", f"{out}/demo.gif"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-filter_complex", fc, "-map", "[out]", "-c:v", "libx264",
                "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp4, "-vf",
                "fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];"
                "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif], check=True)
print(f"{len(segs)} tramos → {mp4}, {gif}")
