import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TranscriptParser, kindFromPath } from "../src/parser";
import { JsonlTailer } from "../src/tailer";
import { encodeProjectDir } from "../src/sessions";

// Líneas sintéticas con la misma forma que las reales (sin datos de nadie).
const use = (id: string, name: string, input: object) =>
  JSON.stringify({ type: "assistant", timestamp: "2026-10-06T10:00:00Z", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: unknown, extra: object = {}) =>
  JSON.stringify({ type: "user", timestamp: "2026-10-06T10:00:01Z", message: { content: [{ type: "tool_result", tool_use_id: id, content, ...extra }] } });
const img = (data = "iVBORw0KGgo=") => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });

describe("TranscriptParser", () => {
  it("Read de una imagen → evento con ruta y base64", () => {
    const p = new TranscriptParser();
    expect(p.parseLine(use("t1", "Read", { file_path: "/tmp/a.png" }))).toEqual([]);
    const ev = p.parseLine(result("t1", [img()]));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ id: "t1", kind: "image", path: "/tmp/a.png", data: "iVBORw0KGgo=", mediaType: "image/png", tool: "Read", action: "read" });
  });

  it("imágenes de herramientas MCP sin ruta (capturas)", () => {
    const p = new TranscriptParser();
    p.parseLine(use("t2", "mcp__chrome__take_screenshot", {}));
    const ev = p.parseLine(result("t2", [{ type: "text", text: "ok" }, img("AAA"), img("BBB")]));
    expect(ev.map((e) => e.id)).toEqual(["t2#0", "t2#1"]);
    expect(ev[0].path).toBeUndefined();
  });

  it("Write de SVG y HTML → eventos de escritura", () => {
    const p = new TranscriptParser();
    p.parseLine(use("w1", "Write", { file_path: "/x/logo.svg", content: "<svg/>" }));
    p.parseLine(use("w2", "Edit", { file_path: "/x/index.HTML" }));
    expect(p.parseLine(result("w1", "File created"))[0]).toMatchObject({ kind: "svg", action: "write" });
    expect(p.parseLine(result("w2", "ok"))[0]).toMatchObject({ kind: "html", action: "write" });
  });

  it("ignora errores, ficheros de texto y herramientas que no tocan archivos", () => {
    const p = new TranscriptParser();
    p.parseLine(use("e1", "Write", { file_path: "/x/a.png" }));
    p.parseLine(use("e2", "Read", { file_path: "/x/notas.md" }));
    p.parseLine(use("e3", "Bash", { command: "ls" }));
    expect(p.parseLine(result("e1", "boom", { is_error: true }))).toEqual([]);
    expect(p.parseLine(result("e2", "texto"))).toEqual([]);
    expect(p.parseLine(result("e3", "a.png"))).toEqual([]);
  });

  it("no rompe con basura ni formatos desconocidos", () => {
    const p = new TranscriptParser();
    for (const l of ["", "{", "null", "[]", '{"type":"mode"}', '{"message":{"content":"texto"}}', '{"message":{"content":[null,1,"x"]}}']) {
      expect(p.parseLine(l)).toEqual([]);
    }
  });
});

describe("kindFromPath", () => {
  it("reconoce extensiones sin importar mayúsculas", () => {
    expect(kindFromPath("/a/B.JPG")).toBe("image");
    expect(kindFromPath("/a/v.mp4")).toBe("video");
    expect(kindFromPath("/a/sin-extension")).toBeUndefined();
  });
});

describe("JsonlTailer", () => {
  it("solo devuelve líneas completas y retoma donde se quedó", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cp-")), "s.jsonl");
    fs.writeFileSync(f, '{"a":1}\n{"b":');
    const t = new JsonlTailer(f);
    t.start(false);
    expect(t.readNew()).toEqual(['{"a":1}']);
    fs.appendFileSync(f, '2}\n{"c":3}\n');
    expect(t.readNew()).toEqual(['{"b":2}', '{"c":3}']);
    expect(t.readNew()).toEqual([]);
    fs.writeFileSync(f, '{"nuevo":1}\n'); // truncado
    expect(t.readNew()).toEqual(['{"nuevo":1}']);
  });
});

describe("encodeProjectDir", () => {
  it("codifica como Claude Code", () => {
    expect(encodeProjectDir("/root")).toBe("-root");
    expect(encodeProjectDir("/home/ana/mi-proyecto")).toBe("-home-ana-mi-proyecto");
  });
});

describe("rutas en comandos de terminal", () => {
  it("saca rutas multimedia de un comando de Bash", async () => {
    const { pathsInCommand } = await import("../src/parser");
    expect(pathsInCommand(`python3 gen.py --out /root/media/gato.png && cp "/tmp/a b.jpg" ~/x/y.webp`)).toEqual(["/root/media/gato.png", "~/x/y.webp"]);
    expect(pathsInCommand("ls -la /root/media")).toEqual([]);
    expect(pathsInCommand("curl https://x.com/a.png -o out/rel.png")).toEqual([]);
  });

  it("Bash → evento de escritura marcado como suposición", () => {
    const p = new TranscriptParser();
    p.parseLine(use("b1", "Bash", { command: "python3 gen.py -o /root/media/foto.jpg" }));
    expect(p.parseLine(result("b1", "ok"))[0]).toMatchObject({ kind: "image", path: "/root/media/foto.jpg", action: "write", guess: true });
  });
});
