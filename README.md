# Preview for Claude Code

> Unofficial. Not affiliated with Anthropic.

See what Claude Code sees. A side panel in VS Code that shows, live, the **images, SVG, HTML and video** Claude Code reads or creates — including when Claude runs on a remote server over **Remote-SSH**.

Today the official extension shows `[Image]` in the chat: Claude sees the picture, you don't. This fixes that.

## How it works

The extension runs next to Claude Code (on the remote host when you use Remote-SSH) and follows the session transcript in `~/.claude/projects/`. When Claude reads an image, writes an SVG or HTML file, or a terminal command produces a media file, it shows up in the panel.

- No servers, no ports, no API keys. It only reads local files.
- HTML opens in a sandboxed panel with scripts **off** by default.

## Status

Early prototype (0.0.x). Things will change.

---

**En español:** panel lateral para VS Code que enseña en vivo las imágenes, SVG, HTML y vídeos que Claude Code lee o genera, también por Remote-SSH.
