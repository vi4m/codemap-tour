#!/usr/bin/env node
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const version = require("../plugin.json").version;
const server = path.join(__dirname, "..", "dist", version, "server.mjs");
const supported = (version) => {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
};
if (supported(process.versions.node)) {
  import(pathToFileURL(server).href).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else {
  const candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
  const node = candidates.find((file) => {
    const result = spawnSync(file, ["-p", "process.versions.node"], {
      encoding: "utf8",
      timeout: 3000,
    });
    return result.status === 0 && supported(result.stdout.trim());
  });
  if (!node) {
    console.error(
      "CodeMap Tour requires Node.js 22.13 or newer. Install it and restart Codex.",
    );
    process.exit(1);
  }
  const child = spawn(node, [server], { stdio: "inherit", env: process.env });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
