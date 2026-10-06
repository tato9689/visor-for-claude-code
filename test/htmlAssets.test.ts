import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inlineLocalAssets } from "../src/htmlAssets";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-html-"));
  fs.mkdirSync(path.join(dir, "img"));
  fs.mkdirSync(path.join(dir, "css"));
  fs.writeFileSync(path.join(dir, "img", "foto con espacio.png"), Buffer.from(PNG, "base64"));
  fs.writeFileSync(path.join(dir, "css", "fondo.png"), Buffer.from(PNG, "base64"));
  fs.writeFileSync(path.join(dir, "css", "estilo.css"), "body{background:url('fondo.png')}");
  fs.writeFileSync(path.join(dir, "app.js"), "document.title='</script>'");
});

describe("inlineLocalAssets", () => {
  it("embebe imágenes relativas, también con espacios codificados y ?query", () => {
    const out = inlineLocalAssets('<img src="img/foto%20con%20espacio.png?v=2">', dir);
    expect(out).toContain('src="data:image/png;base64,');
  });

  it("deja en paz las URL externas, data: y anclas", () => {
    const html = '<img src="https://x.com/a.png"><img src="data:image/png;base64,AA"><a href="#top">x</a>';
    expect(inlineLocalAssets(html, dir)).toBe(html);
  });

  it("deja la etiqueta como estaba si el archivo no existe", () => {
    const html = '<img src="no-existe.png">';
    expect(inlineLocalAssets(html, dir)).toBe(html);
  });

  it("convierte <link> a <style> y resuelve url() relativo al CSS", () => {
    const out = inlineLocalAssets('<link rel="stylesheet" href="css/estilo.css">', dir);
    expect(out).toMatch(/^<style>body\{background:url\(data:image\/png;base64,/);
  });

  it("mete los scripts locales dentro sin romper el cierre", () => {
    const out = inlineLocalAssets('<script src="app.js" defer></script>', dir);
    expect(out).toBe("<script defer>document.title='<\\/script>'</script>");
  });

  it("srcset y style en línea", () => {
    const out = inlineLocalAssets(`<img srcset="css/fondo.png 1x, https://x.com/b.png 2x"><div style="background:url(css/fondo.png)"></div>`, dir);
    expect(out).toContain('srcset="data:image/png;base64,');
    expect(out).toContain(", https://x.com/b.png 2x");
    expect(out).toContain('style="background:url(data:image/png');
  });
});
