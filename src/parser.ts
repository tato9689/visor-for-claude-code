// Lector del historial de Claude Code (~/.claude/projects/<carpeta>/<sesión>.jsonl).
// Independiente de VS Code para poder testearlo solo. El formato no está documentado:
// todo lo que no se reconoce se ignora sin romper.

export type MediaKind = "image" | "svg" | "html" | "video";

export interface MediaEvent {
  id: string;            // id del tool_use, estable para deduplicar
  kind: MediaKind;
  path?: string;         // ruta en disco, si la hay
  data?: string;         // base64, si el historial trae la imagen
  mediaType?: string;    // p. ej. image/png
  tool: string;          // Read, Write, Edit, mcp__…
  action: "read" | "write";
  timestamp?: string;
  /** Ruta sacada de un comando de terminal: hay que comprobar que el archivo existe y es reciente. */
  guess?: boolean;
  doneAt?: string;       // hora del resultado de la herramienta (cuándo acabó el comando)
  /** Viene del historial de un subagente, no de la sesión principal. */
  sub?: boolean;
}

const EXT: Record<string, MediaKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image",
  svg: "svg",
  html: "html", htm: "html",
  mp4: "video", webm: "video", mov: "video",
};

export function kindFromPath(p: string): MediaKind | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? EXT[m[1].toLowerCase()] : undefined;
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Rutas absolutas (o ~/) a archivos multimedia dentro de un comando de terminal.
// También rutas de Windows: C:\\carpeta\\foto.png o C:/carpeta/foto.png.
const PATH_IN_COMMAND = /(?:^|[\s"'=(>])((?:~|\/|[a-zA-Z]:[\\/])[^\s"'<>|;&()]*\.(?:png|jpe?g|gif|webp|avif|svg|html?|mp4|webm|mov))(?=$|[\s"'<>|;&)])/gi;

// Lo mismo entre comillas, que es como van las rutas con espacios ("C:\\Mis juegos\\portada.png").
const QUOTED_PATH_IN_COMMAND = /(["'])((?:~|\/|[a-zA-Z]:[\\/])[^"'\n]*?\.(?:png|jpe?g|gif|webp|avif|svg|html?|mp4|webm|mov))\1/gi;

// Rutas relativas a la carpeta de trabajo («-o art/mayor.png», «./out.webp»), que es como las
// escribe Claude casi siempre. Sin «:» para no confundirlas con URLs ni con unidades de Windows.
const EXTS = "png|jpe?g|gif|webp|avif|svg|html?|mp4|webm|mov";
const REL_PATH_IN_COMMAND = new RegExp(`(?:^|[\\s"'=(>])((?:\\.{1,2}/)?[\\w][^\\s"'<>|;&():]*\\.(?:${EXTS}))(?=$|[\\s"'<>|;&)])`, "gi");
const QUOTED_REL_PATH = new RegExp(`(["'])((?![~/]|[a-zA-Z]:)[^"'\\n:]*?\\.(?:${EXTS}))\\1`, "gi");

/** Rutas relativas a archivos multimedia en un comando; se resuelven contra el cwd del transcript. */
export function relativePathsInCommand(cmd: string): string[] {
  const found = new Set<string>();
  for (const m of cmd.matchAll(QUOTED_REL_PATH)) found.add(m[2]);
  for (const m of cmd.matchAll(REL_PATH_IN_COMMAND)) if (!found.has(m[1])) found.add(m[1]);
  return [...found];
}

/** La ruta tal cual si ya es absoluta (/…, ~/…, C:\\…) o no hay carpeta de trabajo; si no, resuelta contra ella. */
function absolute(p: string, cwd: string | undefined): string {
  return !cwd || /^(?:[\/~]|[a-zA-Z]:[\\/])/.test(p) ? p : resolveFrom(cwd, p);
}

/** Une una ruta relativa con la carpeta de trabajo, con el separador que use esa carpeta. */
export function resolveFrom(cwd: string, rel: string): string {
  const win = /^[a-zA-Z]:\\/.test(cwd);
  const sep = win ? "\\" : "/";
  const clean = rel.replace(/^\.\//, "");
  return cwd.replace(/[\\/]+$/, "") + sep + (win ? clean.replace(/\//g, "\\") : clean);
}

/** Rutas multimedia que aparecen en un comando de Bash (las imágenes de Gemini/fal se generan así). */
export function pathsInCommand(cmd: string): string[] {
  const found = new Set<string>();
  for (const m of cmd.matchAll(QUOTED_PATH_IN_COMMAND)) found.add(m[2]);
  for (const m of cmd.matchAll(PATH_IN_COMMAND)) found.add(m[1]);
  return [...found];
}

// Campos donde las herramientas MCP de imagen/vídeo (fal, Gemini, ComfyUI…) dicen dónde guardan el archivo.
const MCP_PATH_KEYS = ["output_path", "outputPath", "save_path", "savePath", "save_to", "saveTo", "output_file", "outputFile",
  "out", "output", "path", "file", "filename", "image_path", "imagePath", "video_path", "videoPath", "destination"];

/** Ruta multimedia en los argumentos de una herramienta MCP, si la hay. */
function mcpPath(input: any): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  for (const k of MCP_PATH_KEYS) {
    const v = input[k];
    if (typeof v === "string" && kindFromPath(v) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  }
  return undefined;
}

/** El texto de un tool_result (cadena o lista de bloques de texto). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((x: any) => (x?.type === "text" && typeof x.text === "string" ? x.text : "")).join("\n");
}

/** Cuántas cosas ha visto el lector: para explicar un panel vacío en vez de quedarse callado. */
export interface ParserStats { lines: number; badJson: number; toolResults: number; events: number }

/** Estado entre líneas: empareja cada tool_use con su tool_result. */
export class TranscriptParser {
  private pending = new Map<string, { tool: string; path?: string; command?: string; mcp?: string; cwd?: string; timestamp?: string }>();
  readonly stats: ParserStats = { lines: 0, badJson: 0, toolResults: 0, events: 0 };

  /** Procesa una línea del .jsonl y devuelve los eventos multimedia que contiene. */
  parseLine(line: string): MediaEvent[] {
    const out = this.parse(line);
    this.stats.events += out.length;
    return out;
  }

  private parse(line: string): MediaEvent[] {
    this.stats.lines++;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      this.stats.badJson++;
      return [];
    }
    const content = d?.message?.content;
    if (!Array.isArray(content)) return [];
    const out: MediaEvent[] = [];
    const timestamp = typeof d.timestamp === "string" ? d.timestamp : undefined;

    for (const b of content) {
      if (!b || typeof b !== "object") continue;

      if (b.type === "tool_use" && typeof b.id === "string") {
        const tool = String(b.name ?? "");
        const path = typeof b.input?.file_path === "string" ? b.input.file_path : undefined;
        const command = tool === "Bash" && typeof b.input?.command === "string" ? b.input.command : undefined;
        const cwd = typeof d.cwd === "string" ? d.cwd : undefined;
        const mcp = tool.startsWith("mcp__") && !path ? mcpPath(b.input) : undefined;
        this.pending.set(b.id, { tool, path, command, mcp, cwd, timestamp });
        // Escrituras: el archivo ya existe en disco tras la herramienta; avisamos al llegar el resultado.
        continue;
      }

      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const use = this.pending.get(b.tool_use_id);
        this.pending.delete(b.tool_use_id);
        this.stats.toolResults++;
        // Un comando puede fallar después de haber escrito el archivo (p. ej. un «| grep» final): ese sí se mira.
        if (b.is_error && !use?.command) continue;
        const tool = use?.tool ?? "?";
        const isMcp = tool.startsWith("mcp__");
        const images = Array.isArray(b.content)
          ? b.content.filter((x: any) => x?.type === "image" && x.source?.type === "base64")
          : [];

        if (images.length) {
          images.forEach((img: any, i: number) => {
            out.push({
              id: images.length > 1 ? `${b.tool_use_id}#${i}` : b.tool_use_id,
              kind: "image",
              path: use?.path ?? use?.mcp,
              data: img.source.data,
              mediaType: img.source.media_type,
              tool,
              action: isMcp ? "write" : "read", // una herramienta MCP que devuelve una imagen la ha generado
              timestamp: use?.timestamp ?? timestamp,
            });
          });
          continue;
        }

        if (use?.command) {
          const rel = use.cwd ? relativePathsInCommand(use.command).map((r) => resolveFrom(use.cwd!, r)) : [];
          [...new Set([...pathsInCommand(use.command), ...rel])].forEach((p, i) => {
            out.push({ id: `${b.tool_use_id}~${i}`, kind: kindFromPath(p)!, path: p, tool, action: "write", timestamp: use.timestamp ?? timestamp, doneAt: timestamp, guess: true });
          });
          continue;
        }

        // Herramientas MCP de imagen/vídeo: la ruta va en sus argumentos (output_path, save_to…) o en el texto del resultado.
        if (isMcp && use && !use.path) {
          const text = resultText(b.content);
          const rel = use.cwd ? relativePathsInCommand(text).map((r) => resolveFrom(use.cwd!, r)) : [];
          const mcpOwn = use.mcp ? [absolute(use.mcp, use.cwd)] : [];
          [...new Set([...mcpOwn, ...pathsInCommand(text), ...rel])].forEach((p, i) => {
            out.push({ id: `${b.tool_use_id}~${i}`, kind: kindFromPath(p)!, path: p, tool, action: "write", timestamp: use.timestamp ?? timestamp, doneAt: timestamp, guess: true });
          });
          continue;
        }

        if (use?.path) {
          const kind = kindFromPath(use.path);
          if (!kind) continue;
          const action = WRITE_TOOLS.has(tool) ? "write" : tool === "Read" ? "read" : undefined;
          if (!action) continue;
          out.push({ id: b.tool_use_id, kind, path: use.path, tool, action, timestamp: use.timestamp ?? timestamp });
        }
      }
    }
    return out;
  }
}
