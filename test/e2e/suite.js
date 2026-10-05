const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.run = async function () {
  const ws = process.env.CP_WORKSPACE;
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", ws.replace(/[^a-zA-Z0-9]/g, "-"));
  const session = path.join(dir, "sesion.jsonl");
  const png = path.join(ws, "foto.png");
  const svg = path.join(ws, "logo.svg");
  const html = path.join(ws, "pagina.html");
  // PNG de 2x2 píxeles y un SVG sencillo, para no depender de archivos de nadie.
  fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64"));
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#d97757"/><text x="50" y="38" font-size="20" text-anchor="middle" fill="#fff">SVG</text></svg>');
  fs.writeFileSync(html, "<h1>Hola</h1><script>document.body.append('JS!')</script>");
  const line = (o) => JSON.stringify(o) + "\n";
  const use = (id, name, input) => line({ type: "assistant", timestamp: new Date().toISOString(), message: { content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content) => line({ type: "user", timestamp: new Date().toISOString(), message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });

  // Histórico previo: una imagen leída (con base64) y un HTML escrito.
  const b64 = fs.readFileSync(png).toString("base64");
  fs.writeFileSync(session,
    use("a", "Read", { file_path: png }) + res("a", [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }]) +
    use("b", "Write", { file_path: html }) + res("b", "ok"));

  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "preview-for-claude-code");
  if (!ext) throw new Error("extensión no encontrada");
  await ext.activate();
  await vscode.commands.executeCommand("workbench.view.extension.claudePreview");
  await sleep(2500);

  // En vivo: Claude genera un SVG desde la terminal.
  fs.appendFileSync(session, use("c", "Bash", { command: `python3 gen.py -o ${svg}` }) + res("c", "ok"));
  fs.utimesSync(svg, new Date(), new Date());
  await sleep(2500);

  const cmds = await vscode.commands.getCommands(true);
  for (const c of ["claudePreview.clear", "claudePreview.togglePause"]) if (!cmds.includes(c)) throw new Error("falta comando " + c);

  if (process.env.CP_SHOT) execSync(`import -window root ${process.env.CP_SHOT}`);
  console.log("E2E OK");
};
