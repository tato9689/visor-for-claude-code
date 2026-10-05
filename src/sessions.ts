// Encuentra la sesión de Claude Code que corresponde al workspace abierto.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function projectsRoot(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(base, "projects");
}

/** Claude Code guarda cada proyecto en una carpeta con la ruta codificada: /root/mi_web → -root-mi-web */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** El .jsonl más reciente de la carpeta del workspace; si no hay, el más reciente de todos. */
export function findActiveSession(workspacePath: string | undefined): string | undefined {
  const root = projectsRoot();
  if (workspacePath) {
    const own = newestJsonl(path.join(root, encodeProjectDir(workspacePath)));
    if (own) return own;
  }
  let best: { file: string; mtime: number } | undefined;
  for (const dir of safeReaddir(root)) {
    const f = newestJsonl(path.join(root, dir));
    if (!f) continue;
    const mtime = fs.statSync(f).mtimeMs;
    if (!best || mtime > best.mtime) best = { file: f, mtime };
  }
  return best?.file;
}

function newestJsonl(dir: string): string | undefined {
  let best: { file: string; mtime: number } | undefined;
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) best = { file, mtime };
    } catch {
      /* borrado entre readdir y stat */
    }
  }
  return best?.file;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
