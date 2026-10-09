// Prueba de humo: arranca un VS Code real (headless con xvfb-run) con la extensión cargada
// y una sesión de Claude falsa. Uso: xvfb-run -a node test/e2e/run.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const { runTests } = require("@vscode/test-electron");

async function main() {
  // CP_ROOT: carpeta fija (la demo la usa para que las rutas que se ven sean cortas).
  const tmp = process.env.CP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "cp-e2e-"));
  const workspace = path.join(tmp, process.env.CP_WS_NAME || "proyecto");
  const claudeDir = path.join(tmp, "claude");
  if (process.env.CP_TEMPLATE) fs.cpSync(process.env.CP_TEMPLATE, workspace, { recursive: true, preserveTimestamps: true });
  else fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(claudeDir, "projects", workspace.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
  if (process.env.CP_REAL) {
    // Historial vacío y viejo en la carpeta del proyecto: Visor se engancha a él (panel vacío)
    // en vez de a la sesión más reciente de otro proyecto, y salta a la real en cuanto Claude la crea.
    const proj = path.join(os.homedir(), ".claude", "projects", workspace.replace(/[^a-zA-Z0-9]/g, "-"));
    fs.mkdirSync(proj, { recursive: true });
    const vacio = path.join(proj, "00000000-demo-vacio.jsonl");
    fs.writeFileSync(vacio, "");
    fs.utimesSync(vacio, new Date(2020, 0, 1), new Date(2020, 0, 1));
  }
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
    extensionTestsPath: path.resolve(__dirname, process.env.CP_SUITE || "suite.js"), // demo.js graba el GIF
    launchArgs: [workspace, "--disable-extensions", "--disable-gpu", "--no-sandbox"],
    // CP_REAL: la demo usa el Claude Code de verdad, así que Visor lee el ~/.claude real.
    extensionTestsEnv: { ...(process.env.CP_REAL ? {} : { CLAUDE_CONFIG_DIR: claudeDir }), CP_WORKSPACE: workspace, CP_SHOTS: process.env.CP_SHOTS || "",
      CP_ASSETS: process.env.CP_ASSETS || "", CP_REC: process.env.CP_REC || "", CP_MARKS: process.env.CP_MARKS || "",
      CP_LIBRARY: process.env.CP_LIBRARY || "", CP_SLIDER: process.env.CP_SLIDER || "", CP_PICK: process.env.CP_PICK || "", CP_PLAY: process.env.CP_PLAY || "" },
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
