import * as vscode from "vscode";
import * as cp from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MediaEvent, TranscriptParser } from "./parser";
import { JsonlTailer } from "./tailer";
import { findActiveSession, subagentFiles } from "./sessions";
import { VersionStore } from "./versions";
import { inlineLocalAssets } from "./htmlAssets";

const POLL_MS = 700;           // cada cuánto mira si el historial ha crecido
const SESSION_CHECK_MS = 4000; // cada cuánto mira si hay una sesión (o un subagente) más nuevo
const MAX_INLINE_BYTES = 15 * 1024 * 1024;
const MAX_ITEMS = 500;         // tope en memoria para sesiones muy largas
const SNAPSHOT_DAYS = 30;

export function activate(ctx: vscode.ExtensionContext) {
  const provider = new PreviewProvider(ctx);
  const pathOf = (arg: any): string | undefined => (typeof arg?.path === "string" ? arg.path : undefined);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("claudePreview.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("claudePreview.clear", () => provider.clear()),
    vscode.commands.registerCommand("claudePreview.togglePause", () => provider.togglePause()),
    // Menú de clic derecho sobre una tarjeta: VS Code pasa el data-vscode-context de la tarjeta.
    vscode.commands.registerCommand("claudePreview.askChange", (arg) => {
      const p = pathOf(arg);
      if (p) sendToClaude(quotePath(p) + " ");
    }),
    vscode.commands.registerCommand("claudePreview.copyPath", (arg) => {
      const p = pathOf(arg);
      if (p) copyPath(p);
    }),
    vscode.commands.registerCommand("claudePreview.openFile", (arg) => {
      const p = pathOf(arg);
      if (p) vscode.commands.executeCommand("vscode.open", vscode.Uri.file(p));
    }),
    // Para la prueba automática: qué tiene el panel ahora mismo.
    vscode.commands.registerCommand("claudePreview._state", () => provider.debugState()),
    vscode.commands.registerCommand("claudePreview._ui", (msg) => provider.debugUi(msg)),
    { dispose: () => provider.dispose() },
  );
}

export function deactivate() {}

interface Source {
  tailer: JsonlTailer;
  parser: TranscriptParser;
  sub: boolean; // historial de un subagente
}

class PreviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private mainFile?: string;
  private sources = new Map<string, Source>();
  private timers: NodeJS.Timeout[] = [];
  private paused = false;
  private items: MediaEvent[] = [];
  private versions: VersionStore;
  private caps: Record<string, string> = {};
  private lastSound?: string;

  constructor(private ctx: vscode.ExtensionContext) {
    this.versions = new VersionStore(vscode.Uri.joinPath(ctx.globalStorageUri, "versions").fsPath);
    this.versions.prune(SNAPSHOT_DAYS);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      // Claude puede leer o generar archivos en cualquier sitio del disco.
      localResourceRoots: [...diskRoots(), this.ctx.extensionUri, this.ctx.globalStorageUri],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    this.connect();
    this.timers.push(setInterval(() => this.poll(), POLL_MS));
    this.timers.push(setInterval(() => this.checkSession(), SESSION_CHECK_MS));
    view.onDidDispose(() => this.dispose());
  }

  dispose() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  clear() {
    this.items = [];
    this.post({ type: "clear" });
  }

  togglePause() {
    this.paused = !this.paused;
    this.post({ type: "paused", value: this.paused });
  }

  debugState() {
    return {
      session: this.mainFile,
      sources: [...this.sources.keys()],
      items: this.items.map((e) => ({ kind: e.kind, path: e.path, sub: !!e.sub })),
      caps: this.caps,
      lastSound: this.lastSound,
    };
  }

  debugUi(msg: object) {
    this.post({ type: "debug", ...msg });
  }

  private workspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Se engancha a la sesión activa (y a sus subagentes) y carga sus últimos elementos. */
  private connect() {
    const file = findActiveSession(this.workspacePath());
    this.sources.clear();
    this.mainFile = file;
    if (!file) {
      this.post({ type: "status", text: "No hay sesiones de Claude Code todavía." });
      return;
    }
    const events: MediaEvent[] = [];
    for (const f of [file, ...subagentFiles(file)]) events.push(...this.addSource(f, f !== file));
    // Los subagentes corren en paralelo a la sesión principal: se ordena todo por hora.
    events.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
    const max = vscode.workspace.getConfiguration("claudePreview").get<number>("maxItems", 60);
    this.versions.reset();
    this.items = events.slice(-max);
    this.post({ type: "reset", items: this.items.map((e) => this.toView(e)), session: path.basename(file, ".jsonl") });
  }

  /** Empieza a seguir un historial y devuelve lo que ya tenía. */
  private addSource(file: string, sub: boolean): MediaEvent[] {
    const src: Source = { tailer: new JsonlTailer(file), parser: new TranscriptParser(), sub };
    this.sources.set(file, src);
    src.tailer.start(false);
    return this.read(src);
  }

  private read(src: Source): MediaEvent[] {
    const events = src.tailer.readNew().flatMap((l) => src.parser.parseLine(l)).filter(keepGuess);
    if (src.sub) events.forEach((e) => (e.sub = true));
    return events;
  }

  private checkSession() {
    const file = findActiveSession(this.workspacePath());
    if (file && file !== this.mainFile) return this.connect();
    if (!file || this.paused) return;
    for (const f of subagentFiles(file)) {
      if (!this.sources.has(f)) this.emit(this.addSource(f, true));
    }
  }

  private poll() {
    if (this.paused) return;
    for (const [file, src] of this.sources) {
      try {
        this.emit(this.read(src));
      } catch (err) {
        this.post({ type: "status", text: `No puedo leer ${path.basename(file)}: ${(err as Error).message}` });
      }
    }
  }

  private emit(events: MediaEvent[]) {
    for (const e of events) {
      this.items.push(e);
      this.post({ type: "add", item: this.toView(e) });
    }
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
  }

  /** Prepara un elemento para el panel. Las imágenes van por su copia guardada: así cada versión tiene su URL y no sale la vieja de caché. */
  private toView(e: MediaEvent) {
    const webview = this.view!.webview;
    const uri = (f: string) => webview.asWebviewUri(vscode.Uri.file(f)).toString();
    let src: string | undefined;
    let versions: { src: string; timestamp?: string }[] = [];

    if (e.kind === "image" || e.kind === "svg") {
      const bytes = e.data ? Buffer.from(e.data, "base64") : e.path ? readSmall(e.path) : undefined;
      if (bytes && e.path) {
        const list = this.versions.record(e.path, bytes, e.timestamp);
        versions = list.map((v) => ({ src: uri(v.file), timestamp: v.timestamp }));
        src = versions[versions.length - 1]?.src;
      }
      if (!src && e.data && e.mediaType) src = `data:${e.mediaType};base64,${e.data}`;
      else if (!src && bytes && e.kind === "svg") src = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
    } else if (e.kind === "video" && e.path && fs.existsSync(e.path)) {
      const mtime = fs.statSync(e.path).mtimeMs;
      src = webview.asWebviewUri(vscode.Uri.file(e.path)).with({ query: `v=${Math.round(mtime)}` }).toString();
    }

    return {
      id: e.id,
      kind: e.kind,
      path: e.path,
      name: e.path ? path.basename(e.path) : "(imagen sin archivo)",
      action: e.action,
      tool: e.tool,
      timestamp: e.timestamp,
      sub: !!e.sub,
      src,
      versions: versions.length > 1 ? versions : undefined,
      missing: !src && e.kind !== "html",
    };
  }

  private onMessage(m: any) {
    const p = typeof m?.path === "string" ? m.path : undefined;
    switch (m?.type) {
      case "open":
        if (p) vscode.commands.executeCommand("vscode.open", vscode.Uri.file(p));
        break;
      case "copyPath":
        if (p) copyPath(p);
        break;
      case "reveal":
        if (p) vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(p));
        break;
      case "openHtml":
        if (p) openHtmlPanel(p);
        break;
      case "ask":
        if (p) sendToClaude(quotePath(p) + " ");
        break;
      case "pick":
        if (p) sendToClaude(`Me quedo con esta: ${quotePath(p)}`);
        break;
      case "withSound":
        if (p && typeof m.id === "string") this.withSound(m.id, p);
        break;
      case "view":
        this.showInViewer(m);
        break;
      case "caps":
        if (m.caps && typeof m.caps === "object") this.caps = m.caps;
        break;
    }
  }

  /**
   * VS Code no trae el decodificador de audio AAC (el de casi todos los .mp4): el vídeo se ve pero no suena.
   * Con ffmpeg se pasa el audio a Opus sin tocar la imagen (segundos, no recodifica el vídeo).
   */
  private async withSound(id: string, file: string) {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      return this.post({ type: "soundFailed", id, text: "El vídeo ya no está en disco." });
    }
    const key = crypto.createHash("sha1").update(`${file}|${st.size}|${st.mtimeMs}`).digest("hex");
    const dir = vscode.Uri.joinPath(this.ctx.globalStorageUri, "audio").fsPath;
    const out = path.join(dir, key + ".mp4");
    if (!fs.existsSync(out)) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = out + ".part.mp4";
      const args = (codec: string) => ["-y", "-v", "error", "-i", file, "-map", "0:v?", "-map", "0:a?", "-c:v", "copy", "-c:a", codec, "-b:a", "128k", ...(codec === "opus" ? ["-strict", "-2"] : []), tmp];
      try {
        await run("ffmpeg", args("libopus")).catch((err) => (err.code === "ENOENT" ? Promise.reject(err) : run("ffmpeg", args("opus"))));
        fs.renameSync(tmp, out);
      } catch (err: any) {
        try { fs.unlinkSync(tmp); } catch { /* no llegó a crearse */ }
        this.post({ type: "soundFailed", id });
        if (err?.code === "ENOENT") return this.noFfmpeg(file);
        return vscode.window.showErrorMessage(`No he podido preparar el sonido: ${String(err?.message ?? err).slice(0, 300)}`);
      }
    }
    this.lastSound = out;
    const src = this.view?.webview.asWebviewUri(vscode.Uri.file(out)).toString();
    this.post({ type: "videoSrc", id, src });
  }

  private async noFfmpeg(file: string) {
    const how =
      process.platform === "win32" ? "abre una terminal, escribe  winget install Gyan.FFmpeg  y reinicia VS Code" :
      process.platform === "darwin" ? "escribe  brew install ffmpeg  en una terminal" :
      "instálalo con el gestor de paquetes (p. ej.  sudo apt install ffmpeg)";
    const outside = vscode.env.remoteName ? undefined : "Abrir con el reproductor del sistema";
    const pick = await vscode.window.showWarningMessage(
      `Para oír el sonido dentro de VS Code hace falta ffmpeg: ${how}.`,
      ...(outside ? [outside] : []),
    );
    if (pick === outside) vscode.env.openExternal(vscode.Uri.file(file));
  }

  private viewer?: vscode.WebviewPanel;

  /** Visor grande en una pestaña del editor; se reutiliza la misma pestaña. */
  private showInViewer(m: any) {
    const title = m.mode === "grid" ? "Comparar variantes" : m.mode === "compare" ? `Antes / después · ${m.item?.name ?? ""}` : m.item?.name ?? "Visor";
    const msg = { type: m.mode, item: m.item, items: m.items };
    if (this.viewer) {
      this.viewer.title = title;
      this.viewer.reveal(vscode.ViewColumn.Active, false);
      this.viewer.webview.postMessage(msg);
      return;
    }
    const panel = vscode.window.createWebviewPanel("claudePreview.viewer", title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [...diskRoots(), this.ctx.extensionUri, this.ctx.globalStorageUri],
    });
    this.viewer = panel;
    panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, "media", "icon.svg");
    const media = (...f: string[]) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", ...f));
    const nonce = makeNonce();
    const csp = panel.webview.cspSource;
    panel.webview.html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; font-src ${csp}; style-src ${csp}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media("codicons", "codicon.css")}">
<link rel="stylesheet" href="${media("viewer.css")}"></head>
<body><div id="viewer-bar"></div><div id="viewer-body"></div>
<script nonce="${nonce}" src="${media("viewer.js")}"></script></body></html>`;
    panel.webview.onDidReceiveMessage((r) => {
      if (r?.type === "viewerReady") panel.webview.postMessage(msg);
      else if (r?.type === "pick" && typeof r.path === "string") sendToClaude(`Me quedo con esta: ${quotePath(r.path)}`);
    });
    panel.onDidDispose(() => (this.viewer = undefined));
  }

  private post(msg: unknown) {
    this.view?.webview.postMessage(msg);
  }

  private html(webview: vscode.Webview): string {
    const media = (...f: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", ...f));
    const nonce = makeNonce();
    const src = webview.cspSource;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${src} data:; media-src ${src}; font-src ${src}; style-src ${src}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media("codicons", "codicon.css")}">
<link rel="stylesheet" href="${media("panel.css")}"></head>
<body>
<div id="toolbar">
  <div id="kinds" role="group" aria-label="Tipo">
    <button data-kind="all" class="on">Todo</button><button data-kind="image">Imágenes</button><button data-kind="video">Vídeo</button><button data-kind="html">HTML</button>
  </div>
  <div class="row">
    <input id="search" type="search" placeholder="Buscar por nombre">
    <button id="today" title="Solo lo de hoy"><i class="codicon codicon-calendar"></i> Hoy</button>
  </div>
  <div id="selbar" hidden><span id="selcount"></span><button id="compare" class="primary"><i class="codicon codicon-layout"></i> Comparar</button><button id="selclear" title="Quitar selección"><i class="codicon codicon-close"></i></button></div>
</div>
<div id="status"></div><div id="list"></div>
<script nonce="${nonce}" src="${media("panel.js")}"></script></body></html>`;
  }
}

/** Escribe en la terminal donde corre Claude, sin pulsar Enter: el usuario termina la frase. */
function sendToClaude(text: string) {
  const terms = vscode.window.terminals;
  const term = terms.find((t) => /claude/i.test(t.name)) ?? vscode.window.activeTerminal ?? (terms.length === 1 ? terms[0] : undefined);
  if (!term) {
    vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage("No encuentro la terminal de Claude. He copiado el texto: pégalo en el chat de Claude.");
    return;
  }
  term.show(false);
  term.sendText(text, false);
}

function quotePath(p: string): string {
  return /[\s'"]/.test(p) ? `"${p}"` : p;
}

function copyPath(p: string) {
  vscode.env.clipboard.writeText(p);
  vscode.window.setStatusBarMessage("Ruta copiada", 2000);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { timeout: 5 * 60 * 1000, windowsHide: true }, (err, _out, stderr) => {
      if (err) {
        (err as any).message = stderr?.trim() || err.message;
        reject(err);
      } else resolve();
    });
  });
}

/**
 * HTML generado por Claude en un panel aparte, dentro de un iframe aislado. Sin scripts salvo que se pidan.
 * Las imágenes, CSS y scripts locales se embeben: el iframe no puede pedir archivos del disco.
 */
function openHtmlPanel(file: string) {
  const panel = vscode.window.createWebviewPanel("claudePreview.html", path.basename(file), vscode.ViewColumn.Beside, {
    enableScripts: true, // solo para la barra; el iframe tiene su propio sandbox
  });
  let scripts = false;
  const render = () => {
    let content: string;
    try {
      content = inlineLocalAssets(fs.readFileSync(file, "utf8"), path.dirname(file));
    } catch (err) {
      panel.webview.html = `<p>No puedo abrir ${escapeHtml(file)}: ${escapeHtml((err as Error).message)}</p>`;
      return;
    }
    // El iframe srcdoc hereda esta CSP: con scripts activados hay que abrirla.
    const nonce = makeNonce();
    const srcdoc = content.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' about:; img-src https: data:; media-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; script-src ${scripts ? "'unsafe-inline' https:" : `'nonce-${nonce}'`};">
<style>html,body{margin:0;height:100%;display:flex;flex-direction:column;font:13px system-ui}
.bar{padding:6px 10px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #8884}
.bar span{flex:1}iframe{flex:1;border:0;background:#fff}</style></head><body>
<div class="bar"><span>${scripts ? "Scripts activados" : "Modo seguro: sin scripts"}</span>
<button id="r">Recargar</button><button id="t">${scripts ? "Desactivar scripts" : "Activar scripts"}</button></div>
<iframe sandbox="${scripts ? "allow-scripts" : ""}" srcdoc="${srcdoc}"></iframe>
<script nonce="${nonce}">const v=acquireVsCodeApi();document.getElementById('t').onclick=()=>v.postMessage('toggle');document.getElementById('r').onclick=()=>v.postMessage('reload');</script>
</body></html>`;
  };
  panel.webview.onDidReceiveMessage((m) => {
    if (m === "toggle") scripts = !scripts;
    if (m === "toggle" || m === "reload") render();
  });
  render();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Las rutas sacadas de comandos de terminal solo cuentan si el archivo existe y se tocó
 * alrededor del comando (si no, un simple `ls foto.png` llenaría el panel).
 */
function keepGuess(e: MediaEvent): boolean {
  if (!e.guess) return true;
  if (!e.path) return false;
  let file = e.path.startsWith("~/") ? path.join(os.homedir(), e.path.slice(2)) : e.path;
  // En Windows, la terminal de Claude (Git Bash) escribe /c/Juegos/… para C:\\Juegos\\…
  const gitBash = /^\/([a-zA-Z])\/(.*)$/.exec(file);
  if (process.platform === "win32" && gitBash) file = `${gitBash[1].toUpperCase()}:\\${gitBash[2]}`;
  file = path.normalize(file);
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    const when = e.timestamp ? Date.parse(e.timestamp) : Date.now();
    if (Math.abs(st.mtimeMs - when) > 10 * 60 * 1000) return false;
    e.path = file;
    return true;
  } catch {
    return false;
  }
}

/** Raíces del disco: "/" en Linux/macOS; cada unidad (C:\\, D:\\…) en Windows. */
function diskRoots(): vscode.Uri[] {
  if (process.platform !== "win32") return [vscode.Uri.file("/")];
  const roots: vscode.Uri[] = [];
  for (let c = 65; c <= 90; c++) {
    const drive = `${String.fromCharCode(c)}:\\`;
    if (fs.existsSync(drive)) roots.push(vscode.Uri.file(drive));
  }
  return roots;
}

function readSmall(file: string): Buffer | undefined {
  try {
    if (fs.statSync(file).size > MAX_INLINE_BYTES) return undefined;
    return fs.readFileSync(file);
  } catch {
    return undefined;
  }
}

function makeNonce(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}
