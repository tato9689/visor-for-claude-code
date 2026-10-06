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

/** Rutas multimedia que aparecen en un comando de Bash (las imágenes de Gemini/fal se generan así). */
export function pathsInCommand(cmd: string): string[] {
  const found = new Set<string>();
  for (const m of cmd.matchAll(QUOTED_PATH_IN_COMMAND)) found.add(m[2]);
  for (const m of cmd.matchAll(PATH_IN_COMMAND)) found.add(m[1]);
  return [...found];
}

/** Estado entre líneas: empareja cada tool_use con su tool_result. */
export class TranscriptParser {
  private pending = new Map<string, { tool: string; path?: string; command?: string; timestamp?: string }>();

  /** Procesa una línea del .jsonl y devuelve los eventos multimedia que contiene. */
  parseLine(line: string): MediaEvent[] {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
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
        this.pending.set(b.id, { tool, path, command, timestamp });
        // Escrituras: el archivo ya existe en disco tras la herramienta; avisamos al llegar el resultado.
        continue;
      }

      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const use = this.pending.get(b.tool_use_id);
        this.pending.delete(b.tool_use_id);
        if (b.is_error) continue;
        const tool = use?.tool ?? "?";
        const images = Array.isArray(b.content)
          ? b.content.filter((x: any) => x?.type === "image" && x.source?.type === "base64")
          : [];

        if (images.length) {
          images.forEach((img: any, i: number) => {
            out.push({
              id: images.length > 1 ? `${b.tool_use_id}#${i}` : b.tool_use_id,
              kind: "image",
              path: use?.path,
              data: img.source.data,
              mediaType: img.source.media_type,
              tool,
              action: "read",
              timestamp: use?.timestamp ?? timestamp,
            });
          });
          continue;
        }

        if (use?.command) {
          pathsInCommand(use.command).forEach((p, i) => {
            out.push({ id: `${b.tool_use_id}~${i}`, kind: kindFromPath(p)!, path: p, tool, action: "write", timestamp: use.timestamp ?? timestamp, guess: true });
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
