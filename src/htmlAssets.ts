// Mete dentro del HTML las imágenes, CSS y scripts que enlaza con ruta relativa.
// El HTML se pinta en un iframe aislado (srcdoc) que no puede pedir archivos del disco,
// así que todo lo local tiene que ir embebido. Independiente de VS Code para testearlo solo.
import * as fs from "fs";
import * as path from "path";

const MAX_ASSET_BYTES = 15 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  css: "text/css", js: "text/javascript",
};

const MEDIA_EXT = Object.keys(MIME).filter((e) => e !== "css" && e !== "js");

/** ¿Es una ruta local relativa (o absoluta del disco), no una URL? */
function isLocal(ref: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || /^[a-zA-Z]:[\\/]/.test(ref);
}

/** Resuelve una referencia contra la carpeta base; quita ?query y #ancla. */
function resolveRef(ref: string, baseDir: string): string | undefined {
  const clean = ref.trim().replace(/[?#].*$/, "");
  if (!clean || !isLocal(clean)) return undefined;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    /* ruta con % suelto: se usa tal cual */
  }
  return path.resolve(baseDir, decoded);
}

/**
 * Lee el archivo solo si es del tipo esperado (también a donde apunte si es un enlace simbólico).
 * Así una página no puede meterse dentro, como "CSS", una clave SSH u otro archivo privado
 * y luego mandarlo fuera con los scripts activados.
 */
function readSmall(file: string, allowed: string[]): Buffer | undefined {
  try {
    const real = fs.realpathSync(file);
    const ok = (f: string) => allowed.includes(path.extname(f).slice(1).toLowerCase());
    if (!ok(file) || !ok(real)) return undefined;
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > MAX_ASSET_BYTES) return undefined;
    return fs.readFileSync(real);
  } catch {
    return undefined;
  }
}

function dataUri(file: string): string | undefined {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return undefined;
  const buf = readSmall(file, MEDIA_EXT);
  return buf ? `data:${mime};base64,${buf.toString("base64")}` : undefined;
}

/** url(...) dentro de CSS → data: URI, relativo a la carpeta del CSS. */
export function inlineCssUrls(css: string, baseDir: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, _q, ref) => {
    const file = resolveRef(ref, baseDir);
    const uri = file && dataUri(file);
    // Sin comillas: un data: en base64 no lleva espacios, comillas ni paréntesis, y así vale también dentro de style="…".
    return uri ? `url(${uri})` : whole;
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** Devuelve el HTML con sus recursos locales embebidos. */
export function inlineLocalAssets(html: string, baseDir: string): string {
  // <link rel="stylesheet" href="x.css"> → <style>…</style>
  let out = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = attr(tag, "href");
    const file = href && resolveRef(href, baseDir);
    const buf = file && readSmall(file, ["css"]);
    if (!file || !buf) return tag;
    const css = inlineCssUrls(buf.toString("utf8"), path.dirname(file));
    return `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  });

  // <script src="x.js"></script> → <script>…</script> (solo corre si se activan los scripts)
  out = out.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
    const src = attr(` ${attrs}`, "src");
    const file = src && resolveRef(src, baseDir);
    const buf = file && readSmall(file, ["js", "mjs"]);
    if (!file || !buf) return tag;
    const rest = attrs.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    return `<script${rest}>${buf.toString("utf8").replace(/<\/script/gi, "<\\/script")}</script>`;
  });

  // <style> y style="…" con url(...)
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_w, a, css, b) => a + inlineCssUrls(css, baseDir) + b);
  out = out.replace(/(\sstyle\s*=\s*)(["'])([^"']*url\([^"']*)\2/gi, (_w, a, q, css) => a + q + inlineCssUrls(css, baseDir) + q);

  // src / poster de img, video, audio, source…
  out = out.replace(/(\s(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi, (whole, a, q, ref) => {
    const file = resolveRef(ref, baseDir);
    const uri = file && dataUri(file);
    return uri ? a + q + uri + q : whole;
  });

  // srcset="a.png 1x, b.png 2x"
  out = out.replace(/(\ssrcset\s*=\s*)(["'])([^"']+)\2/gi, (_w, a, q, set: string) => {
    const parts = set.split(",").map((p) => {
      const [ref, ...desc] = p.trim().split(/\s+/);
      const file = resolveRef(ref, baseDir);
      const uri = file && dataUri(file);
      return [uri ?? ref, ...desc].join(" ");
    });
    return a + q + parts.join(", ") + q;
  });

  return out;
}
