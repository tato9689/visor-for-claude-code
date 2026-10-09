# Regrabar la demo (docs/demo.gif y docs/demo.mp4)

La demo es una sesión **real** de Claude Code. `test/e2e/demo.js` abre un VS Code de verdad en un Xvfb, arranca `claude` en su terminal (con `lanzar-claude.sh` y los permisos de `demo-permisos.json`), le escribe cinco peticiones y espera a que termine cada turno leyendo su transcript de `~/.claude/projects/`. Visor lee ese mismo transcript. Lo único preparado son los retratos: `tools/portrait.py` copia renders ya hechos en vez de generarlos (pixel art bueno en directo costaría dinero y no saldría igual). El ratón se mueve con `xdotool`.

Necesita `xvfb-run`, `xdotool`, `ffmpeg`, ImageMagick y Claude Code con sesión iniciada.

## Material (fuera del repo: es arte del juego Cubs of Brutality)

- **Plantilla del proyecto** (`CP_TEMPLATE`): `test/e2e/demo-workspace/` más `art/portraits/lumberjack.png` (versión vieja), `art/portraits/innkeeper.png`, `art/shroomlands.png`, `art/trailer.mp4` (30 s del tráiler, sin audio) y `web/world/index.html`. Con fechas antiguas (`touch -d '3 days ago'`), para que Visor no tome los ficheros de entrada por recién creados.
- **Renders** (`CP_LIBRARY`): `mayor_a.png`, `mayor_b.png`, `mayor_c.png`, `lumberjack_v2.png`.

## Grabar

```bash
npm run build
rm -rf /tmp/demo ~/.claude/projects/-tmp-demo-cubs-of-brutality && mkdir -p /tmp/demo
CP_REAL=1 CP_ROOT=/tmp/demo CP_WS_NAME=cubs-of-brutality CP_SUITE=demo.js \
CP_TEMPLATE=<plantilla> CP_LIBRARY=<renders> \
CP_REC=raw.mp4 CP_MARKS=marks.json CP_SLIDER=682,1066,536 CP_PICK=873,437 CP_PLAY=88,488 \
xvfb-run -a -s "-screen 0 1400x900x24" node test/e2e/run.js
python3 test/e2e/montar_demo.py raw.mp4 marks.json docs
```

- Las coordenadas (deslizador del antes/después, «Keep this one» de la variante del medio, play del vídeo) se miden con `CP_SHOTS=<carpeta>` en lugar de `CP_REC`. Si cambia la interfaz, hay que volver a medirlas.
- `run.js` deja un historial vacío y antiguo en la carpeta del proyecto, para que Visor no enseñe al principio la sesión más reciente de otro proyecto.
- La primera vez Claude Code pregunta si confías en la carpeta; `demo.js` contesta que sí.
- `montar_demo.py` recorta la barra de título, pone a 4x los ratos en que Claude trabaja y el resto a 1,15x.
