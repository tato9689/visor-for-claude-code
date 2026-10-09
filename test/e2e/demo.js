// Graba el GIF de demostración con material real (retratos y tráiler del juego de Tato).
// No es una prueba: monta una sesión de Claude falsa, la va escribiendo en vivo y mueve
// el ratón con xdotool. Uso: ver docs/demo.md.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotDir = process.env.CP_SHOTS; // capturas sueltas para medir coordenadas
let n = 0;
async function shot(name) {
  if (!shotDir) return;
  await sleep(600);
  execSync(`import -window root ${path.join(shotDir, `${String(++n).padStart(2, "0")}-${name}.png`)}`);
}
const xdo = (args) => execSync(`xdotool ${args}`);

exports.run = async function () {
  const ws = process.env.CP_WORKSPACE;
  const A = process.env.CP_ASSETS;
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", ws.replace(/[^a-zA-Z0-9]/g, "-"));
  const session = path.join(dir, "sesion.jsonl");
  const art = path.join(ws, "art");
  fs.mkdirSync(path.join(art, "portraits"), { recursive: true });
  fs.mkdirSync(path.join(ws, "web", "world"), { recursive: true });
  const P = (f) => path.join(art, "portraits", f);
  const lumber = P("lumberjack.png");
  const mayors = ["mayor_a.png", "mayor_b.png", "mayor_c.png"].map(P);
  const inn = P("innkeeper.png");
  const shot1 = path.join(art, "shroomlands.png");
  const trailer = path.join(art, "trailer_cut.mp4");
  const world = path.join(ws, "web", "world", "index.html");

  const line = (o) => JSON.stringify(o) + "\n";
  const ts = () => new Date().toISOString();
  const use = (id, name, input) => line({ type: "assistant", timestamp: ts(), message: { content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content) => line({ type: "user", timestamp: ts(), message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
  const img = (f, mt) => [{ type: "image", source: { type: "base64", media_type: mt, data: fs.readFileSync(f).toString("base64") } }];
  const add = (s) => fs.appendFileSync(session, s);

  // Lo que ya había en la sesión: Claude miró una captura del juego y dos retratos.
  fs.copyFileSync(path.join(A, "shroomlands.png"), shot1);
  fs.copyFileSync(path.join(A, "innkeeper.png"), inn);
  fs.copyFileSync(path.join(A, "lumberjack_v1.png"), lumber);
  fs.writeFileSync(session,
    use("a", "Read", { file_path: shot1 }) + res("a", img(shot1, "image/png")) +
    use("b", "Read", { file_path: inn }) + res("b", img(inn, "image/png")) +
    use("c", "Read", { file_path: lumber }) + res("c", img(lumber, "image/png")));

  // Terminal «claude» que enseña lo que se le escribe (así se ve el «I'll keep this one»).
  const out = new vscode.EventEmitter();
  const say = (s) => out.fire(s.replace(/\n/g, "\r\n"));
  const pty = { onDidWrite: out.event, open() {}, close() {}, handleInput: (d) => say(d) };
  const term = vscode.window.createTerminal({ name: "claude", pty });

  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "visor-for-claude-code");
  await ext.activate();
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await vscode.commands.executeCommand("notifications.toggleDoNotDisturbMode").then(undefined, () => {});
  await vscode.commands.executeCommand("workbench.view.extension.visor");
  term.show(true);
  await sleep(2500);
  xdo(`search --onlyvisible --class Code windowmove 0 0 windowsize 1400 900`);
  await sleep(1500);

  await vscode.commands.executeCommand("notifications.clearAll");
  await sleep(500);
  let rec;
  if (process.env.CP_REC) {
    rec = spawn("ffmpeg", ["-v", "error", "-y", "-f", "x11grab", "-draw_mouse", "1", "-framerate", "25",
      "-video_size", "1400x900", "-i", process.env.DISPLAY + "+0,0", "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "18", "-pix_fmt", "yuv420p", process.env.CP_REC], { stdio: ["pipe", "inherit", "inherit"] });
    await sleep(1200);
  }
  const O = "\x1b[38;5;209m", G = "\x1b[90m", R = "\x1b[0m";
  const prompt = async (s) => { say(`\n${O}>${R} `); for (const ch of s) { say(ch); await sleep(28); } say("\n"); await sleep(500); };
  const tool = (s) => say(`${O}●${R} ${s}\n`);

  await shot("inicio");
  await prompt("Draw three takes on the mayor portrait");
  for (const [i, m] of mayors.entries()) {
    fs.copyFileSync(path.join(A, path.basename(m)), m);
    tool(`Write(${path.relative(ws, m)})`);
    add(use("m" + i, "Write", { file_path: m }) + res("m" + i, "ok"));
    await sleep(1100);
  }
  await prompt("Cut 6 seconds of the trailer for the store page");
  tool(`Bash(ffmpeg -ss 20 -t 6 -i trailer.mp4 ${path.relative(ws, trailer)})`);
  fs.copyFileSync(path.join(A, "trailer.mp4"), trailer);
  add(use("v", "Bash", { command: `ffmpeg -ss 20 -t 6 -i trailer.mp4 -an "${trailer}"` }) + res("v", "ok"));
  await sleep(1800);
  await prompt("Redo the lumberjack, much more detail");
  tool(`Bash(python3 gen_portrait.py lumberjack)`);
  fs.copyFileSync(path.join(A, "lumberjack_v2.png"), lumber);
  add(use("l", "Bash", { command: `python3 gen_portrait.py lumberjack -o "${lumber}"` }) + res("l", "ok"));
  await sleep(2200);
  await shot("panel");
  const [vx, vy] = (process.env.CP_PLAY || "0,0").split(",").map(Number);
  if (vy) { xdo(`mousemove ${vx} ${vy}`); await sleep(400); xdo(`click 1`); await sleep(1200); } // el tráiler se reproduce en el panel

  // Antes / después del leñador, arrastrando el deslizador.
  await vscode.commands.executeCommand("visor._ui", { action: "compare", path: lumber });
  await sleep(1500);
  await shot("comparar");
  const [sx1, sx2, sy] = (process.env.CP_SLIDER || "0,0,0").split(",").map(Number);
  if (sy) {
    const mid = Math.round((sx1 + sx2) / 2);
    xdo(`mousemove ${mid} ${sy}`); await sleep(400);
    xdo(`mousedown 1`);
    for (const x of [...steps(mid, sx1 + 20, 18), ...steps(sx1 + 20, sx2 - 20, 30), ...steps(sx2 - 20, mid, 14)]) {
      xdo(`mousemove ${x} ${sy}`); await sleep(35);
    }
    xdo(`mouseup 1`);
    await sleep(800);
  }
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  // Las tres variantes del alcalde en cuadrícula; se elige una.
  for (const m of mayors) { await vscode.commands.executeCommand("visor._ui", { action: "select", path: m }); await sleep(350); }
  await vscode.commands.executeCommand("visor._ui", { action: "grid" });
  await sleep(1600);
  await shot("cuadricula");
  const [px, py] = (process.env.CP_PICK || "0,0").split(",").map(Number);
  if (py) {
    xdo(`mousemove ${px - 120} ${py - 80}`); await sleep(300);
    for (const t of steps(0, 1, 12)) { xdo(`mousemove ${Math.round(px - 120 + 120 * t)} ${Math.round(py - 80 + 80 * t)}`); await sleep(30); }
    await sleep(500);
    xdo(`click 1`);
    await sleep(1800);
  }
  await shot("elegido");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  // Pixel art nítido y la página del mundo en HTML.
  await vscode.commands.executeCommand("visor._ui", { action: "image", path: mayors[1] });
  await sleep(3200);
  await shot("pixel");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await prompt("Update the world guide page");
  fs.copyFileSync(path.join(A, "world", "index.html"), world);
  tool(`Write(${path.relative(ws, world)})`);
  add(use("w", "Write", { file_path: world }) + res("w", "ok"));
  await sleep(1800);
  await vscode.commands.executeCommand("visor._ui", { action: "html", path: world });
  await sleep(3000);
  await shot("html");

  if (rec) { rec.stdin.write("q"); await new Promise((r) => rec.on("close", r)); }
  console.log("DEMO OK");
};

function steps(a, b, k) {
  return Array.from({ length: k }, (_, i) => Math.round(a + ((b - a) * (i + 1)) / k));
}
