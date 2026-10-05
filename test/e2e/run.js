// Prueba de humo: arranca un VS Code real (headless con xvfb-run) con la extensión cargada
// y una sesión de Claude falsa. Uso: xvfb-run -a node test/e2e/run.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-e2e-"));
  const workspace = path.join(tmp, "proyecto");
  const claudeDir = path.join(tmp, "claude");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(claudeDir, "projects", workspace.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
    extensionTestsPath: path.resolve(__dirname, "suite.js"),
    launchArgs: [workspace, "--disable-extensions", "--disable-gpu", "--no-sandbox"],
    extensionTestsEnv: { CLAUDE_CONFIG_DIR: claudeDir, CP_WORKSPACE: workspace, CP_SHOT: process.env.CP_SHOT || "" },
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
