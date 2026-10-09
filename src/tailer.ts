// Lee un fichero que crece (el .jsonl de la sesión) solo desde donde se quedó.
// Nunca relee el fichero entero: hay sesiones de varios MB.
import * as fs from "fs";

export class JsonlTailer {
  private offset = 0;
  private rest: Buffer = Buffer.alloc(0); // línea a medio escribir (en bytes: una tilde puede quedar partida entre dos lecturas)

  constructor(public readonly file: string) {}

  /** Empieza desde el final (solo lo nuevo) o desde el principio (para cargar el histórico). */
  start(fromEnd: boolean): void {
    this.offset = fromEnd ? safeSize(this.file) : 0;
    this.rest = Buffer.alloc(0);
  }

  /** Devuelve las líneas completas añadidas desde la última llamada. */
  readNew(): string[] {
    const size = safeSize(this.file);
    if (size < this.offset) {
      // Fichero truncado o reemplazado: empezar de cero.
      this.offset = 0;
      this.rest = Buffer.alloc(0);
    }
    if (size === this.offset) return [];
    const fd = fs.openSync(this.file, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      const n = fs.readSync(fd, buf, 0, buf.length, this.offset); // puede leer menos si el fichero encogió
      this.offset += n;
      const data = Buffer.concat([this.rest, buf.subarray(0, n)]);
      // Se corta por el byte \n (nunca forma parte de un carácter UTF-8 de varios bytes) y solo entonces se decodifica.
      const end = data.lastIndexOf(0x0a);
      this.rest = Buffer.from(data.subarray(end + 1));
      if (end < 0) return [];
      return data.subarray(0, end).toString("utf8").split("\n").filter((l) => l.trim().length > 0);
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
