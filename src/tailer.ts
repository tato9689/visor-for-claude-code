// Lee un fichero que crece (el .jsonl de la sesión) solo desde donde se quedó.
// Nunca relee el fichero entero: hay sesiones de varios MB.
import * as fs from "fs";

export class JsonlTailer {
  private offset = 0;
  private rest = ""; // línea a medio escribir

  constructor(public readonly file: string) {}

  /** Empieza desde el final (solo lo nuevo) o desde el principio (para cargar el histórico). */
  start(fromEnd: boolean): void {
    this.offset = fromEnd ? safeSize(this.file) : 0;
    this.rest = "";
  }

  /** Devuelve las líneas completas añadidas desde la última llamada. */
  readNew(): string[] {
    const size = safeSize(this.file);
    if (size < this.offset) {
      // Fichero truncado o reemplazado: empezar de cero.
      this.offset = 0;
      this.rest = "";
    }
    if (size === this.offset) return [];
    const fd = fs.openSync(this.file, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const text = this.rest + buf.toString("utf8");
      const lines = text.split("\n");
      this.rest = lines.pop() ?? "";
      return lines.filter((l) => l.trim().length > 0);
    } finally {
      fs.closeSync(fd);
    }
  }
}

function safeSize(f: string): number {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}
