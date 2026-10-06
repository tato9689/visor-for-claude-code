import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const json = (f: string) => JSON.parse(readFileSync(join(root, f), "utf8"));

describe("traducciones", () => {
  // Cada t("…") del código debe estar en el paquete en español, y el paquete no debe tener textos huérfanos.
  it("el paquete español cubre exactamente los textos del código", () => {
    const src = readFileSync(join(root, "src/extension.ts"), "utf8");
    const used = new Set([...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(["'])/g, "$1")));
    const es = new Set(Object.keys(json("l10n/bundle.l10n.es.json")));
    expect([...used].filter((k) => !es.has(k))).toEqual([]);
    expect([...es].filter((k) => !used.has(k))).toEqual([]);
  });

  it("package.nls.es.json tiene las mismas claves que package.nls.json", () => {
    expect(Object.keys(json("package.nls.es.json")).sort()).toEqual(Object.keys(json("package.nls.json")).sort());
  });

  it("todo %clave% del manifiesto existe", () => {
    const manifest = readFileSync(join(root, "package.json"), "utf8");
    const nls = json("package.nls.json");
    for (const [, k] of manifest.matchAll(/"%([^%"]+)%"/g)) expect(nls[k], k).toBeTypeOf("string");
  });

  it("las plantillas con {0} conservan el marcador en español", () => {
    const es = json("l10n/bundle.l10n.es.json");
    for (const [en, tr] of Object.entries<string>(es)) {
      const n = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join();
      expect(n(tr), en).toBe(n(en));
    }
  });
});
