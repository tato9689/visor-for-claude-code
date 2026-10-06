import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { VersionStore } from "../src/versions";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cp-ver-"));

describe("VersionStore", () => {
  it("apunta solo las versiones que cambian y guarda copia de cada una", () => {
    const s = new VersionStore(tmp());
    expect(s.record("/a.png", Buffer.from("uno"))).toHaveLength(1);
    expect(s.record("/a.png", Buffer.from("uno"))).toHaveLength(1);
    const v = s.record("/a.png", Buffer.from("dos"));
    expect(v).toHaveLength(2);
    expect(fs.readFileSync(v[0].file, "utf8")).toBe("uno");
    expect(fs.readFileSync(v[1].file, "utf8")).toBe("dos");
    expect(path.extname(v[1].file)).toBe(".png");
  });

  it("si se vuelve a una versión anterior, no la duplica", () => {
    const s = new VersionStore(tmp());
    s.record("/a.png", Buffer.from("uno"));
    s.record("/a.png", Buffer.from("dos"));
    const v = s.record("/a.png", Buffer.from("uno"));
    expect(v.map((x) => fs.readFileSync(x.file, "utf8"))).toEqual(["dos", "uno"]);
  });

  it("no guarda más de 10 por archivo y no mezcla archivos", () => {
    const s = new VersionStore(tmp());
    for (let i = 0; i < 15; i++) s.record("/a.png", Buffer.from(String(i)));
    expect(s.record("/a.png", Buffer.from("14"))).toHaveLength(10);
    expect(s.record("/b.png", Buffer.from("x"))).toHaveLength(1);
  });

  it("prune borra copias viejas", () => {
    const dir = tmp();
    const s = new VersionStore(dir);
    const [v] = s.record("/a.png", Buffer.from("uno"));
    const old = new Date(Date.now() - 40 * 864e5);
    fs.utimesSync(v.file, old, old);
    s.prune(30);
    expect(fs.existsSync(v.file)).toBe(false);
  });
});
