import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MediaEvent, TranscriptParser } from "./parser";
import { JsonlTailer } from "./tailer";
import { findActiveSession } from "./sessions";

const POLL_MS = 700;           // cada cuánto mira si el historial ha crecido
const SESSION_CHECK_MS = 4000; // cada cuánto mira si hay una sesión más nueva
const MAX_INLINE_BYTES = 15 * 1024 * 1024;

export function activate(ctx: vscode.ExtensionContext) {
  const provider = new PreviewProvider(ctx);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("claudePreview.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("claudePreview.clear", () => provider.clear()),
    vscode.commands.registerCommand("claudePreview.togglePause", () => provider.togglePause()),
    { dispose: () => provider.dispose() },
  );
}

export function deactivate() {}

class PreviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private tailer?: JsonlTailer;
  private parser = new TranscriptParser();
  private timers: NodeJS.Timeout[] = [];
  private paused = false;
  private items: MediaEvent[] = [];

  constructor(private ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      // Claude puede leer o generar archivos en cualquier sitio del disco.
      localResourceRoots: [vscode.Uri.file("/"), this.ctx.extensionUri],
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

  private workspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Se engancha a la sesión activa y carga sus últimos elementos. */
  private connect() {
    const file = findActiveSession(this.workspacePath());
    if (!file) {
      this.post({ type: "status", text: "No hay sesiones de Claude Code todavía." });
      return;
    }
    this.tailer = new JsonlTailer(file);
    this.parser = new TranscriptParser();
    this.tailer.start(false);
    const max = vscode.workspace.getConfiguration("claudePreview").get<number>("maxItems", 60);
    const events = this.tailer.readNew().flatMap((l) => this.parser.parseLine(l)).filter(keepGuess);
    this.items = events.slice(-max);
    this.post({ type: "reset", items: this.items.map((e) => this.toView(e)), session: path.basename(file, ".jsonl") });
  }

  private checkSession() {
    const file = findActiveSession(this.workspacePath());
    if (file && file !== this.tailer?.file) this.connect();
  }

  private poll() {
    if (!this.tailer || this.paused) return;
    let lines: string[];
    try {
      lines = this.tailer.readNew();
    } catch (err) {
      this.post({ type: "status", text: `No puedo leer el historial: ${(err as Error).message}` });
      return;
    }
    for (const e of lines.flatMap((l) => this.parser.parseLine(l)).filter(keepGuess)) {
      this.items.push(e);
      this.post({ type: "add", item: this.toView(e) });
    }
  }

  /** Prepara un elemento para el panel: imagen embebida o URI del archivo en disco. */
  private toView(e: MediaEvent) {
    const webview = this.view!.webview;
    let src: string | undefined;
    if (e.data && e.mediaType) {
      src = `data:${e.mediaType};base64,${e.data}`;
    } else if (e.path && fs.existsSync(e.path)) {
      if (e.kind === "svg") {
        // Como <img> el SVG no ejecuta scripts.
        src = fileAsDataUri(e.path, "image/svg+xml");
      } else if (e.kind === "image" || e.kind === "video") {
        src = webview.asWebviewUri(vscode.Uri.file(e.path)).toString();
      }
    }
    return {
      id: e.id,
      kind: e.kind,
      path: e.path,
      name: e.path ? path.basename(e.path) : "(imagen sin archivo)",
      action: e.action,
      tool: e.tool,
      timestamp: e.timestamp,
      src,
      missing: !src && e.kind !== "html",
    };
  }

  private onMessage(m: any) {
    if (m?.type === "open" && typeof m.path === "string") {
      vscode.commands.executeCommand("vscode.open", vscode.Uri.file(m.path));
    } else if (m?.type === "copyPath" && typeof m.path === "string") {
      vscode.env.clipboard.writeText(m.path);
      vscode.window.setStatusBarMessage("Ruta copiada", 2000);
    } else if (m?.type === "reveal" && typeof m.path === "string") {
      vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(m.path));
    } else if (m?.type === "openHtml" && typeof m.path === "string") {
      openHtmlPanel(m.path, false);
    }
  }

  private post(msg: unknown) {
    this.view?.webview.postMessage(msg);
  }

  private html(webview: vscode.Webview): string {
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", f));
    const nonce = makeNonce();
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media("panel.css")}"></head>
<body><div id="status"></div><div id="list"></div>
<div id="viewer" hidden><button id="close" title="Cerrar">✕</button><div id="viewer-body"></div></div>
<script nonce="${nonce}" src="${media("panel.js")}"></script></body></html>`;
  }
}

/** HTML generado por Claude en un panel aparte, dentro de un iframe aislado. Sin scripts salvo que se pidan. */
function openHtmlPanel(file: string, allowScripts: boolean) {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(`No puedo abrir ${file}: ${(err as Error).message}`);
    return;
  }
  const panel = vscode.window.createWebviewPanel("claudePreview.html", path.basename(file), vscode.ViewColumn.Beside, {
    enableScripts: true, // solo para el botón; el iframe tiene su propio sandbox
  });
  const render = (scripts: boolean) => {
    // El iframe srcdoc hereda esta CSP: con scripts activados hay que abrirla.
    const nonce = makeNonce();
    const srcdoc = content.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' about:; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; script-src ${scripts ? "'unsafe-inline' https:" : `'nonce-${nonce}'`};">
<style>html,body{margin:0;height:100%;display:flex;flex-direction:column;font:13px system-ui}
.bar{padding:6px 10px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #8884}
iframe{flex:1;border:0;background:#fff}</style></head><body>
<div class="bar"><span>${scripts ? "⚠️ Scripts activados" : "🔒 Modo seguro: sin scripts"}</span>
<button id="t">${scripts ? "Desactivar scripts" : "Activar scripts"}</button></div>
<iframe sandbox="${scripts ? "allow-scripts" : ""}" srcdoc="${srcdoc}"></iframe>
<script nonce="${nonce}">const v=acquireVsCodeApi();document.getElementById('t').onclick=()=>v.postMessage('toggle');</script>
</body></html>`;
  };
  let scripts = allowScripts;
  panel.webview.onDidReceiveMessage((m) => {
    if (m === "toggle") {
      scripts = !scripts;
      render(scripts);
    }
  });
  render(scripts);
}

/**
 * Las rutas sacadas de comandos de terminal solo cuentan si el archivo existe y se tocó
 * alrededor del comando (si no, un simple `ls foto.png` llenaría el panel).
 */
function keepGuess(e: MediaEvent): boolean {
  if (!e.guess) return true;
  if (!e.path) return false;
  const file = e.path.startsWith("~/") ? path.join(os.homedir(), e.path.slice(2)) : e.path;
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

function fileAsDataUri(file: string, mime: string): string | undefined {
  try {
    if (fs.statSync(file).size > MAX_INLINE_BYTES) return undefined;
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return undefined;
  }
}

function makeNonce(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}
