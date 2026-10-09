// 0.2.4: las mejoras menores de la auditoría del 9-oct.
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findSessions, encodeProjectDir, ACTIVE_MS } from "../src/sessions";
import { TranscriptParser } from "../src/parser";
import { inlineLocalAssets } from "../src/htmlAssets";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cp-024-"));
let projects: string;

function session(ws: string, name: string, ageMs: number, cwd = ws) {
  const dir = path.join(projects, encodeProjectDir(ws));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name + ".jsonl");
  fs.writeFileSync(f, JSON.stringify({ type: "user", cwd, message: { content: "hola" } }) + "\n");
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(f, t, t);
  return f;
}

describe("findSessions", () => {
  beforeEach(() => {
    const base = tmp();
    process.env.CLAUDE_CONFIG_DIR = base;
    projects = path.join(base, "projects");
    fs.mkdirSync(projects);
  });

  it("dos Claude en el mismo proyecto: sigue los dos (y no uno viejo)", () => {
    const a = session("/w/juego", "a", 1000);
    const b = session("/w/juego", "b", 5000);
    session("/w/juego", "vieja", ACTIVE_MS + 60_000);
    const s = findSessions(["/w/juego"])!;
    expect(s.own).toBe(true);
    expect(s.main).toBe(a);
    expect(s.files).toEqual([a, b]);
  });

  it("workspace con varias carpetas: elige la que tiene actividad más reciente", () => {
    session("/w/web", "x", 60_000);
    const y = session("/w/juego", "y", 1000);
    expect(findSessions(["/w/web", "/w/juego"])!.main).toBe(y);
  });

  it("sin sesión en el proyecto: la última de otro, marcada como ajena y con su carpeta", () => {
    session("/w/otro proyecto", "z", 1000);
    const s = findSessions(["/w/juego"])!;
    expect(s.own).toBe(false);
    expect(s.project).toBe("/w/otro proyecto");
  });

  it("sin ~/.claude/projects todavía: no hay sesiones (no es un error)", () => {
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp(), "no-existe");
    expect(findSessions(["/w/juego"])).toBeUndefined();
  });
});

const line = (o: object) => JSON.stringify(o);
const use = (id: string, name: string, input: object, extra: object = {}) =>
  line({ type: "assistant", timestamp: "2026-10-09T10:00:00Z", cwd: "/w/juego", ...extra, message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: unknown, extra: object = {}) =>
  line({ type: "user", timestamp: "2026-10-09T10:01:00Z", message: { content: [{ type: "tool_result", tool_use_id: id, content, ...extra }] } });

describe("herramientas MCP de imagen y vídeo", () => {
  it("la ruta de salida en los argumentos (output_path, save_to…)", () => {
    const p = new TranscriptParser();
    p.parseLine(use("m1", "mcp__fal__generate_image", { prompt: "un lobo", output_path: "art/lobo.png" }));
    expect(p.parseLine(result("m1", "done"))).toMatchObject([{ path: "/w/juego/art/lobo.png", action: "write", guess: true, tool: "mcp__fal__generate_image" }]);
  });

  it("la ruta en el texto del resultado", () => {
    const p = new TranscriptParser();
    p.parseLine(use("m2", "mcp__gemini__image", { prompt: "portada" }));
    const ev = p.parseLine(result("m2", [{ type: "text", text: "Saved to /tmp/salida/portada.webp (1024x1024)" }]));
    expect(ev.map((e) => e.path)).toEqual(["/tmp/salida/portada.webp"]);
  });

  it("una imagen devuelta por una herramienta MCP cuenta como generada, no como leída", () => {
    const p = new TranscriptParser();
    p.parseLine(use("m3", "mcp__img__make", { save_to: "/tmp/a.png" }));
    const [e] = p.parseLine(result("m3", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }]));
    expect(e).toMatchObject({ action: "write", path: "/tmp/a.png" });
  });

  it("no confunde una URL con un archivo, ni toca herramientas que no son MCP", () => {
    const p = new TranscriptParser();
    p.parseLine(use("m4", "mcp__fal__run", { output: "https://fal.media/x.png" }));
    expect(p.parseLine(result("m4", "ok"))).toEqual([]);
    p.parseLine(use("g1", "Glob", { pattern: "**/*.png" }));
    expect(p.parseLine(result("g1", "/w/juego/a.png\n/w/juego/b.png"))).toEqual([]);
  });
});

describe("Bash que falla después de escribir", () => {
  it("el archivo se mira igual (el filtro de fechas decide)", () => {
    const p = new TranscriptParser();
    p.parseLine(use("b1", "Bash", { command: "python3 gen.py -o /tmp/x.png | grep nada" }));
    expect(p.parseLine(result("b1", "exit 1", { is_error: true }))).toMatchObject([{ path: "/tmp/x.png" }]);
  });
});

describe("contadores para explicar un panel vacío", () => {
  it("cuenta líneas, ilegibles, resultados y eventos", () => {
    const p = new TranscriptParser();
    p.parseLine("{roto");
    p.parseLine(use("r1", "Read", { file_path: "/w/notas.md" }));
    p.parseLine(result("r1", "texto"));
    p.parseLine(use("r2", "Write", { file_path: "/w/a.svg" }));
    p.parseLine(result("r2", "ok"));
    expect(p.stats).toEqual({ lines: 5, badJson: 1, toolResults: 2, events: 1 });
  });
});

describe("HTML: apunta lo que no se pudo cargar", () => {
  it("lista los recursos locales que faltan o están fuera del proyecto", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "ok.png"), Buffer.from("89504e47", "hex"));
    const skipped: string[] = [];
    inlineLocalAssets('<img src="ok.png"><img src="falta.png"><script src="/etc/app.js"></script><link rel="stylesheet" href="../fuera.css"><img src="https://x.com/a.png">', root, root, skipped);
    expect(skipped.sort()).toEqual(["../fuera.css", "/etc/app.js", "falta.png"]);
  });
});
