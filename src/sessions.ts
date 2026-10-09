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

/** Lo que el panel sigue: una o varias sesiones de la misma carpeta de proyecto. */
export interface Sessions {
  dir: string;        // carpeta de ~/.claude/projects
  main: string;       // la sesión más reciente
  files: string[];    // main y las demás sesiones de esa carpeta con actividad reciente (dos Claude a la vez)
  own: boolean;       // false: no hay sesión de este workspace y se enseña la última de otro proyecto
  project?: string;   // carpeta de trabajo de esa sesión (para decir de qué proyecto es)
}

/** Una sesión que no se ha tocado en este tiempo ya no se sigue en paralelo. */
export const ACTIVE_MS = 30 * 60 * 1000;

/**
 * Las sesiones de la carpeta del workspace (si hay varias carpetas, la que tenga actividad más reciente);
 * si ninguna tiene, la última sesión de cualquier proyecto, marcada como ajena.
 * Lanza un error si ~/.claude/projects existe pero no se puede leer (permisos), para poder decirlo.
 */
export function findSessions(workspacePaths: string[], now = Date.now()): Sessions | undefined {
  const root = projectsRoot();
  let best: { dir: string; list: Jsonl[] } | undefined;
  for (const ws of workspacePaths) {
    const dir = path.join(root, encodeProjectDir(ws));
    const list = jsonls(dir);
    if (list.length && (!best || list[0].mtime > best.list[0].mtime)) best = { dir, list };
  }
  let own = true;
  if (!best) {
    own = false;
    for (const name of readdirOrThrow(root)) {
      const dir = path.join(root, name);
      const list = jsonls(dir);
      if (list.length && (!best || list[0].mtime > best.list[0].mtime)) best = { dir, list };
    }
  }
  if (!best) return undefined;
  const [first, ...rest] = best.list;
  const files = [first.file, ...rest.filter((j) => now - j.mtime < ACTIVE_MS).map((j) => j.file)];
  return { dir: best.dir, main: first.file, files, own, project: own ? undefined : sessionCwd(first.file) };
}

/** Compatibilidad: solo la sesión principal. */
export function findActiveSession(workspacePath: string | undefined): string | undefined {
  return findSessions(workspacePath ? [workspacePath] : [])?.main;
}

/** La carpeta de trabajo que Claude apunta en cada línea del historial («cwd»), mirando solo el principio. */
export function sessionCwd(file: string): string | undefined {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const m = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(buf.subarray(0, n).toString("utf8"));
      return m ? JSON.parse(`"${m[1]}"`) : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

interface Jsonl { file: string; mtime: number }

/** Los .jsonl de una carpeta, del más reciente al más viejo. */
function jsonls(dir: string): Jsonl[] {
  const out: Jsonl[] = [];
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    try {
      out.push({ file, mtime: fs.statSync(file).mtimeMs });
    } catch {
      /* borrado entre readdir y stat */
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function readdirOrThrow(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; // aún no se ha usado Claude Code
    throw err;
  }
}

/** Historiales de los subagentes de una sesión: <sesión>/subagents/*.jsonl */
export function subagentFiles(sessionFile: string): string[] {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ""), "subagents");
  return safeReaddir(dir)
    .filter((n) => n.endsWith(".jsonl"))
    .map((n) => path.join(dir, n));
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
