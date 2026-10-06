const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotDir = process.env.CP_SHOTS;
let n = 0;
async function shot(name) {
  if (!shotDir) return;
  await vscode.commands.executeCommand("notifications.clearAll");
  await sleep(900);
  execSync(`import -window root ${path.join(shotDir, `${String(++n).padStart(2, "0")}-${name}.png`)}`);
}
function check(cond, msg) {
  if (!cond) throw new Error("FALLO: " + msg);
  console.log("  ok -", msg);
}

exports.run = async function () {
  const ws = process.env.CP_WORKSPACE;
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", ws.replace(/[^a-zA-Z0-9]/g, "-"));
  const session = path.join(dir, "sesion.jsonl");
  const subDir = path.join(dir, "sesion", "subagents");
  const sprite = path.join(ws, "sprite heroe.png"); // con espacio a propósito
  const foto = path.join(ws, "foto.jpg");
  const svg = path.join(ws, "logo.svg");
  const html = path.join(ws, "web", "pagina.html");
  const video = path.join(ws, "clip.mp4");
  fs.mkdirSync(path.join(ws, "web", "img"), { recursive: true });

  // Sprite de 16×16 (pixel art) y una foto grande; generados aquí para no depender de archivos de nadie.
  execSync(`convert -size 16x16 xc:none -fill '#d97757' -draw 'rectangle 4,2 11,13' -fill '#222' -draw 'point 6,5' -draw 'point 9,5' png32:"${sprite}"`);
  execSync(`convert -size 480x320 gradient:'#335'-'#c96' -fill white -pointsize 40 -gravity center -annotate 0 'FOTO' "${foto}"`);
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#d97757"/><text x="50" y="38" font-size="20" text-anchor="middle" fill="#fff">SVG</text></svg>');
  execSync(`convert -size 120x80 xc:'#2a7' "${path.join(ws, "web", "img", "verde.png")}"`);
  fs.writeFileSync(path.join(ws, "web", "estilo.css"), "h1{color:#c33;font-family:sans-serif}");
  fs.writeFileSync(html, '<link rel="stylesheet" href="estilo.css"><h1>Hola desde un HTML</h1><p>Imagen relativa:</p><img src="img/verde.png"><script>document.body.append("JS!")</script>');

  const line = (o) => JSON.stringify(o) + "\n";
  const ts = () => new Date().toISOString();
  const use = (id, name, input) => line({ type: "assistant", timestamp: ts(), message: { content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content) => line({ type: "user", timestamp: ts(), message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
  const b64 = (f) => fs.readFileSync(f).toString("base64");

  // Histórico previo: el sprite leído (con base64) y el HTML escrito.
  fs.writeFileSync(session,
    use("a", "Read", { file_path: sprite }) + res("a", [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64(sprite) } }]) +
    use("b", "Write", { file_path: html }) + res("b", "ok"));

  // Terminal falsa llamada "claude" que apunta lo que le escriben.
  let typed = "";
  const pty = { onDidWrite: new vscode.EventEmitter().event, open() {}, close() {}, handleInput: (d) => (typed += d) };
  vscode.window.createTerminal({ name: "claude", pty });

  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "visor-for-claude-code");
  if (!ext) throw new Error("extensión no encontrada");
  await ext.activate();
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await vscode.commands.executeCommand("workbench.view.extension.visor");
  await sleep(2500);
  const state = () => vscode.commands.executeCommand("visor._state");
  check((await state()).items.length === 2, "carga el histórico (2 elementos)");
  {
    const { language, sample } = await state();
    check(sample === (language.startsWith("es") ? "Hoy" : "Today"), `textos en el idioma de VS Code (${language} → ${sample})`);
  }

  // En vivo: Claude rehace el sprite desde la terminal → segunda versión.
  execSync(`convert -size 16x16 xc:none -fill '#5a8dee' -draw 'rectangle 3,1 12,14' -fill '#fff' -draw 'point 6,5' -draw 'point 9,5' png32:"${sprite}"`);
  fs.appendFileSync(session, use("c", "Bash", { command: `python3 gen.py -o "${sprite}"` }) + res("c", "ok"));
  // …y un SVG, una foto y un vídeo con audio AAC (el normal de un .mp4).
  execSync(`ffmpeg -v error -y -f lavfi -i testsrc=size=320x180:rate=24 -f lavfi -i sine=frequency=440 -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac "${video}"`);
  fs.appendFileSync(session,
    use("d", "Write", { file_path: svg }) + res("d", "ok") +
    use("e", "Bash", { command: `fal run kling -o ${video}` }) + res("e", "ok"));
  // Un subagente lee la foto.
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, "agent-1.jsonl"),
    use("f", "Read", { file_path: foto }) + res("f", [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64(foto) } }]));
  await sleep(5500);

  const s = await state();
  console.log("  items:", s.items.map((i) => path.basename(i.path || "?")).join(", "));
  check(s.items.length === 6, `llegan los nuevos en vivo (${s.items.length}/6)`);
  check(s.items.some((i) => i.sub && i.path === foto), "sigue al subagente");
  console.log("  caps del panel:", JSON.stringify(s.caps));
  await shot("panel");

  // Pixel art ampliado.
  await vscode.commands.executeCommand("visor._ui", { action: "image", path: sprite });
  await shot("sprite-ampliado");
  // Antes / después.
  await vscode.commands.executeCommand("visor._ui", { action: "compare", path: sprite });
  await shot("antes-despues");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  // Variantes en cuadrícula.
  for (const p of [sprite, foto, svg]) await vscode.commands.executeCommand("visor._ui", { action: "select", path: p });
  await shot("seleccion");
  await vscode.commands.executeCommand("visor._ui", { action: "grid" });
  await shot("cuadricula");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  // Filtro.
  await vscode.commands.executeCommand("visor._ui", { action: "kind", value: "video" });
  await shot("filtro-video");
  await vscode.commands.executeCommand("visor._ui", { action: "kind", value: "all" });

  // «Cambiar»: escribe la ruta en la terminal de Claude, sin Enter.
  await vscode.commands.executeCommand("visor.askChange", { path: sprite });
  await sleep(500);
  check(typed === `"${sprite}" `, `escribe la ruta entre comillas en la terminal de Claude: ${JSON.stringify(typed)}`);

  // Una ruta con salto de línea no se escribe nunca (sería como pulsar Enter).
  typed = "";
  await vscode.commands.executeCommand("visor.askChange", { path: "/tmp/x.png\nrm -rf ~" });
  await sleep(300);
  check(typed === "", "no escribe rutas con saltos de línea");

  // Sonido: si VS Code no sabe AAC (versiones viejas), pasa el audio a Opus con ffmpeg.
  await vscode.commands.executeCommand("visor._ui", { action: "soundForce", path: video });
  for (let i = 0; i < 20 && !(await state()).lastSound; i++) await sleep(500);
  const out = (await state()).lastSound;
  check(out && fs.existsSync(out), "prepara el vídeo con sonido");
  const codecs = execSync(`ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "${out}"`).toString().trim().split("\n");
  check(codecs.includes("h264") && codecs.includes("opus"), `vídeo intacto + audio Opus (${codecs.join(", ")})`);

  // HTML con imagen y CSS relativos.
  await vscode.commands.executeCommand("visor._ui", { action: "html", path: html });
  await shot("html");

  const cmds = await vscode.commands.getCommands(true);
  for (const c of ["visor.clear", "visor.togglePause", "visor.askChange"]) check(cmds.includes(c), "comando " + c);
  console.log("E2E OK");
};
