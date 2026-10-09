#!/bin/bash
# Claude Code limpio para la demo: sin las variables de la sesión que lo lanza (si se graba
# desde dentro de otro Claude Code) y sin autoinstalar su extensión en el VS Code de pruebas.
# Uso (lo arranca demo.js como shell de la terminal): DEMO_LIBRARY=<renders> lanzar-claude.sh
for v in $(env | grep -oE '^(CLAUDE[A-Z_]*|CLAUDECODE|ANTHROPIC[A-Z_]*)='); do unset "${v%=}"; done
export CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL=1
export HOME="${HOME:-/root}" PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" TERM=xterm-256color
exec claude --settings "$(dirname "$0")/demo-permisos.json" --model haiku
