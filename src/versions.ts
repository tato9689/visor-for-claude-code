// Guarda copia de cada versión distinta de una imagen para poder comparar antes/después.
// Cuando Claude rehace un archivo lo sobrescribe en disco: si no copiamos la versión anterior
// en el momento en que la vemos, se pierde. Independiente de VS Code para testearlo solo.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface Version {
  hash: string;
  file: string;       // copia guardada en la carpeta de la extensión
  timestamp?: string;
}

const MAX_VERSIONS = 10; // por archivo

export class VersionStore {
  private byPath = new Map<string, Version[]>();

  constructor(private dir: string) {}

  /** Olvida el historial en memoria (las copias en disco se quedan para reutilizarlas). */
  reset(): void {
    this.byPath.clear();
  }

  /**
   * Apunta una versión del archivo si su contenido es distinto del último visto. Devuelve todas las versiones,
   * o undefined si no se pudo guardar la copia (el panel enseña entonces el archivo tal cual, sin antes/después).
   */
  record(filePath: string, bytes: Buffer, timestamp?: string): Version[] | undefined {
    const hash = crypto.createHash("sha1").update(bytes).digest("hex");
    const list = this.byPath.get(filePath) ?? [];
    const last = list[list.length - 1];
    if (last?.hash !== hash) {
      const copy = path.join(this.dir, hash + path.extname(filePath).toLowerCase());
      try {
        if (fs.existsSync(copy)) {
          const now = new Date();
          fs.utimesSync(copy, now, now); // sigue en uso: que prune() no la borre
        } else {
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(copy, bytes);
        }
        // Si la misma versión ya estaba más atrás (p. ej. se deshizo un cambio), se mueve al final.
        const again = list.findIndex((v) => v.hash === hash);
        if (again >= 0) list.splice(again, 1);
        list.push({ hash, file: copy, timestamp });
        if (list.length > MAX_VERSIONS) list.splice(0, list.length - MAX_VERSIONS);
        this.byPath.set(filePath, list);
      } catch {
        // Sin sitio donde copiar (disco lleno, carpeta de solo lectura): sin antes/después para esta versión.
        return undefined;
      }
    }
    return list.slice();
  }

  /** Borra copias que llevan más de `days` días sin usarse. */
  prune(days: number): void {
    const limit = Date.now() - days * 24 * 60 * 60 * 1000;
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const f = path.join(this.dir, name);
      try {
        if (fs.statSync(f).mtimeMs < limit) fs.unlinkSync(f);
      } catch {
        /* ya no está */
      }
    }
  }
}
