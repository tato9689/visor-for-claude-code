// Graba la demo con una sesión REAL de Claude Code en la terminal de VS Code y Visor leyendo
// su transcript de verdad. El material es del juego de Tato (retratos, tráiler sin sonido,
// página /world). Ver docs/demo.md.
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawn } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotDir = process.env.CP_SHOTS; // capturas sueltas para medir coordenadas
let n = 0;
async function shot(name) {
  if (!shotDir) return;
  await sleep(500);
  execSync(`import -window root ${path.join(shotDir, `${String(++n).padStart(2, "0")}-${name}.png`)}`);
}
const xdo = (args) => execSync(`xdotool ${args}`);
const nums = (v, k) => (v || "").split(",").map(Number).concat(Array(k).fill(0)).slice(0, k);

exports.run = async function () {
  const ws = process.env.CP_WORKSPACE;
  const projDir = path.join(os.homedir(), ".claude", "projects", ws.replace(/[^a-zA-Z0-9]/g, "-"));
  const lumber = path.join(ws, "art/portraits/lumberjack.png");
  const mayors = ["a", "b", "c"].map((k) => path.join(ws, `art/portraits/mayor_${k}.png`));
  const world = path.join(ws, "web/world/index.html");

  // Turnos terminados de Claude, leídos del transcript real.
  const endTurns = () => {
    if (!fs.existsSync(projDir)) return 0;
    let k = 0;
    for (const f of fs.readdirSync(projDir).filter((f) => f.endsWith(".jsonl"))) {
      for (const l of fs.readFileSync(path.join(projDir, f), "utf8").split("\n")) {
        if (!l.includes('"end_turn"')) continue;
        try { const o = JSON.parse(l); if (o.type === "assistant" && o.message?.stop_reason === "end_turn") k++; } catch {}
      }
    }
    return k;
  };

  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "visor-for-claude-code");
  await ext.activate();
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await vscode.commands.executeCommand("notifications.toggleDoNotDisturbMode").then(undefined, () => {});
  await vscode.commands.executeCommand("workbench.view.extension.visor");

  // Claude Code de verdad, arrancado directamente (sin shell delante).
  const term = vscode.window.createTerminal({
    name: "claude", cwd: ws, shellPath: path.join(__dirname, "lanzar-claude.sh"), // limpia el entorno y ejecuta claude
    env: { DEMO_LIBRARY: process.env.CP_LIBRARY },
  });
  term.show(false);
  await sleep(2500);
  xdo(`search --onlyvisible --class Code windowmove 0 0 windowsize 1400 900`);
  await sleep(6000);
  await shot("arranque");
  term.sendText("\x1b[B", false); await sleep(400); term.sendText("\r", false); // «Yes, I trust this folder» (la primera vez)
  await sleep(3000);
  term.sendText("/clear", false); await sleep(500); term.sendText("\r", false); // pantalla limpia antes de grabar
  await sleep(2500);
  await shot("listo");
  await vscode.commands.executeCommand("notifications.clearAll");

  const marks = [];
  let t0 = Date.now();
  const mark = (label) => marks.push({ t: (Date.now() - t0) / 1000, label });
  let rec;
  if (process.env.CP_REC) {
    rec = spawn("ffmpeg", ["-v", "error", "-y", "-f", "x11grab", "-draw_mouse", "1", "-framerate", "25",
      "-video_size", "1400x900", "-i", process.env.DISPLAY + "+0,0", "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "18", "-pix_fmt", "yuv420p", process.env.CP_REC], { stdio: ["pipe", "inherit", "inherit"] });
    await sleep(1000);
    t0 = Date.now();
  }

  const ask = async (text, timeout = 180000) => {
    const before = endTurns();
    for (const ch of text) { term.sendText(ch, false); await sleep(35); }
    await sleep(400);
    term.sendText("\r", false);
    mark("espera");
    const t = Date.now();
    while (endTurns() <= before) {
      if (Date.now() - t > timeout) { await shot("atasco"); throw new Error("Claude no terminó: " + text); }
      await sleep(500);
    }
    await sleep(1500);
    mark("fin");
  };

  await ask("Look at art/portraits/lumberjack.png and art/shroomlands.png. One line: what are they?");
  await ask("Make three takes of the mayor portrait: mayor_a, mayor_b and mayor_c in art/portraits/");
  await ask("Cut 6 seconds of art/trailer.mp4 starting at 0:10, no audio, into art/trailer_cut.mp4");
  await ask("The lumberjack looks rough. Redo it with much more detail (take v2)");
  await shot("panel");

  const [vx, vy] = nums(process.env.CP_PLAY, 2);
  if (vy) { xdo(`mousemove ${vx} ${vy}`); await sleep(400); xdo(`click 1`); await sleep(1500); }

  // Antes / después del leñador, arrastrando el deslizador.
  await vscode.commands.executeCommand("visor._ui", { action: "compare", path: lumber });
  await sleep(1800);
  await shot("comparar");
  const [sx1, sx2, sy] = nums(process.env.CP_SLIDER, 3);
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

  // Las tres variantes del alcalde; se elige la del medio y Visor se lo escribe a Claude.
  for (const m of mayors) { await vscode.commands.executeCommand("visor._ui", { action: "select", path: m }); await sleep(350); }
  await vscode.commands.executeCommand("visor._ui", { action: "grid" });
  await sleep(1800);
  await shot("cuadricula");
  const [px, py] = nums(process.env.CP_PICK, 2);
  if (py) {
    for (const t of steps(0, 1, 12)) { xdo(`mousemove ${Math.round(px - 120 + 120 * t)} ${Math.round(py - 80 + 80 * t)}`); await sleep(30); }
    await sleep(500);
    xdo(`click 1`);
    await sleep(1500);
    await shot("elegido");
    const before = endTurns();
    term.sendText("\r", false); // Claude recibe «I'll keep this one: …» y contesta
    mark("espera");
    for (let t = Date.now(); endTurns() <= before && Date.now() - t < 120000;) await sleep(500);
    await sleep(1500);
    mark("fin");
  }
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  // Pixel art nítido.
  await vscode.commands.executeCommand("visor._ui", { action: "image", path: mayors[1] });
  await sleep(3000);
  await shot("pixel");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  // La página del mundo: Claude la edita y se abre en Visor.
  await ask("Add a line under the title of web/world/index.html: \"New: the mayor has a new portrait.\"");
  await vscode.commands.executeCommand("visor._ui", { action: "html", path: world });
  await sleep(3500);
  await shot("html");

  if (rec) { rec.stdin.write("q"); await new Promise((r) => rec.on("close", r)); }
  if (process.env.CP_MARKS) fs.writeFileSync(process.env.CP_MARKS, JSON.stringify(marks, null, 2));
  term.sendText("\x03", false); await sleep(300); term.sendText("\x03", false); // cierra Claude
  await sleep(1000);
  console.log("DEMO OK", JSON.stringify(marks));
};

function steps(a, b, k) {
  return Array.from({ length: k }, (_, i) => Math.round(a + ((b - a) * (i + 1)) / k));
}
