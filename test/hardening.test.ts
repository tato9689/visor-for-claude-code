// Arreglos de la auditoría del 9-oct (0.2.3).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inlineLocalAssets } from "../src/htmlAssets";
import { JsonlTailer } from "../src/tailer";
import { VersionStore } from "../src/versions";
import { TranscriptParser } from "../src/parser";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cp-hard-"));

describe("HTML: solo se embebe lo del proyecto", () => {
  it("no mete scripts, CSS ni imágenes de fuera de la carpeta raíz", () => {
    const root = tmp();
    const fuera = tmp();
    fs.mkdirSync(path.join(root, "web", "world"), { recursive: true });
    fs.writeFileSync(path.join(root, "web", "style.css"), "body{color:red}");
    fs.writeFileSync(path.join(fuera, "config.js"), "const KEY='secreto'");
    fs.writeFileSync(path.join(fuera, "s.css"), "body{color:blue}");
    const base = path.join(root, "web", "world");
    const rel = path.relative(base, path.join(fuera, "config.js"));
    const html = `<link rel="stylesheet" href="../style.css"><script src="${rel}"></script><link rel="stylesheet" href="${path.join(fuera, "s.css")}">`;
    const out = inlineLocalAssets(html, base, root);
    expect(out).toContain("<style>body{color:red}</style>"); // ../style.css sigue dentro del proyecto
    expect(out).not.toContain("secreto");
    expect(out).not.toContain("color:blue");
  });

  it("tampoco a través de un enlace simbólico que sale del proyecto", () => {
    const root = tmp();
    const fuera = tmp();
    fs.writeFileSync(path.join(fuera, "app.js"), "robar()");
    fs.symlinkSync(path.join(fuera, "app.js"), path.join(root, "app.js"));
    expect(inlineLocalAssets('<script src="app.js"></script>', root, root)).not.toContain("robar");
  });
});

describe("JsonlTailer", () => {
  it("no rompe una letra con tilde que queda partida entre dos lecturas", () => {
    const d = tmp();
    const f = path.join(d, "s.jsonl");
    const line = JSON.stringify({ path: "/home/tato/Mis juegos/portada_añadida.png" }) + "\n";
    const bytes = Buffer.from(line, "utf8");
    const cut = bytes.indexOf(Buffer.from("ñ", "utf8")) + 1; // en medio de los dos bytes de «ñ»
    fs.writeFileSync(f, bytes.subarray(0, cut));
    const t = new JsonlTailer(f);
    t.start(false);
    expect(t.readNew()).toEqual([]);
    fs.appendFileSync(f, bytes.subarray(cut));
    expect(t.readNew()).toEqual([line.trimEnd()]);
  });
});

describe("VersionStore", () => {
  it("avisa si no puede guardar la copia (en vez de devolver la versión anterior como si fuera la nueva)", () => {
    const d = tmp();
    const blocker = path.join(d, "no-es-carpeta");
    fs.writeFileSync(blocker, "x"); // la carpeta de copias es un archivo: mkdir falla
    const store = new VersionStore(path.join(blocker, "versions"));
    expect(store.record("/x/a.png", Buffer.from("v1"))).toBeUndefined();
  });
});

describe("comandos largos", () => {
  it("el resultado lleva la hora en que acabó el comando", () => {
    const p = new TranscriptParser();
    p.parseLine(JSON.stringify({ type: "assistant", timestamp: "2026-10-09T10:00:00Z", cwd: "/w", message: { content: [{ type: "tool_use", id: "k", name: "Bash", input: { command: "fal run kling -o out/v.mp4" } }] } }));
    const [e] = p.parseLine(JSON.stringify({ type: "user", timestamp: "2026-10-09T10:25:00Z", message: { content: [{ type: "tool_result", tool_use_id: "k", content: "ok" }] } }));
    expect(e).toMatchObject({ path: "/w/out/v.mp4", timestamp: "2026-10-09T10:00:00Z", doneAt: "2026-10-09T10:25:00Z" });
  });
});
