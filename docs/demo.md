# Regrabar la demo (docs/demo.gif y docs/demo.mp4)

`test/e2e/demo.js` abre un VS Code real en un Xvfb, escribe en vivo una sesión de Claude falsa con material del juego Cubs of Brutality (retratos, una captura, 6 s del tráiler sin sonido y la página /world) y mueve el ratón con `xdotool`. Necesita `xvfb-run`, `xdotool`, `ffmpeg` e ImageMagick.

Material: carpeta con `lumberjack_v1.png`, `lumberjack_v2.png`, `mayor_a/b/c.png`, `innkeeper.png`, `shroomlands.png`, `trailer.mp4` y `world/index.html` (sale del repo del juego y de `/var/www/roguelike/world`).

```bash
npm run build
rm -rf /tmp/demo && mkdir -p /tmp/demo
CP_ROOT=/tmp/demo CP_SUITE=demo.js CP_WS_NAME=cubs-of-brutality CP_ASSETS=<material> \
CP_REC=raw.mp4 CP_SLIDER=682,1066,536 CP_PICK=873,437 CP_PLAY=88,488 \
xvfb-run -a -s "-screen 0 1400x900x24" node test/e2e/run.js
```

Las coordenadas (deslizador del antes/después, botón «Keep this one» de la variante del medio, play del vídeo) se midieron con `CP_SHOTS=<carpeta>` en vez de `CP_REC`. Si cambia la interfaz, se vuelven a medir.

Montaje (recorta la barra de título y acelera 1,15x):

```bash
ffmpeg -ss 1 -i raw.mp4 -vf "crop=1400:864:0:36,setpts=PTS/1.15,tpad=stop_mode=clone:stop_duration=1.5" -an -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart docs/demo.mp4
ffmpeg -i docs/demo.mp4 -vf "fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/demo.gif
```
