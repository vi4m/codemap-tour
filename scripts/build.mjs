import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { build } from "esbuild";
const plugin = resolve("plugins/codemap-tour");
const manifest = JSON.parse(
  await readFile(join(plugin, "plugin.json"), "utf8"),
);
const output = join(plugin, "dist", manifest.version);
await mkdir(output, { recursive: true });
const browser = await build({
  entryPoints: ["src/widget.tsx"],
  bundle: true,
  write: false,
  outdir: output,
  platform: "browser",
  format: "iife",
  target: "chrome114",
  minify: true,
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = browser.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const css = browser.outputFiles.find((file) =>
  file.path.endsWith(".css"),
)?.text;
if (!js || !css) throw new Error("Missing reader assets");
await writeFile(
  join(output, "widget.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Code Tour</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
);
const server = await build({
  entryPoints: ["src/server/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(output, "server.mjs"),
  metafile: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
// Generated only for direct SDK tests. The shipped MCP manifest uses portable paths.
await writeFile(
  join(plugin, "test-mcp.json"),
  JSON.stringify(
    {
      mcpServers: {
        "codemap-tour": {
          command: process.execPath,
          args: [join(output, "server.mjs")],
          env: { CODEMAP_TOUR_PLUGIN_VERSION: manifest.version },
        },
      },
    },
    null,
    2,
  ) + "\n",
);
const packages = new Map();
const expectedPackages = new Set();
for (const input of new Set([
  ...Object.keys(browser.metafile.inputs),
  ...Object.keys(server.metafile.inputs),
])) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(input));
  while (
    directory !== dirname(directory) &&
    directory.includes("/node_modules/")
  ) {
    try {
      const pkg = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (pkg.name && pkg.version) {
        expectedPackages.add(pkg.name);
        let text = "";
        for (const name of [
          "LICENSE",
          "LICENSE.txt",
          "LICENSE.md",
          "license",
          "license.txt",
          "License",
          "LICENSE-MIT",
          "LICENSE-MIT.txt",
        ]) {
          try {
            text = await readFile(join(directory, name), "utf8");
            break;
          } catch {}
        }
        if (text) {
          packages.set(pkg.name, { directory, pkg, text });
          break;
        }
      }
    } catch {}
    directory = dirname(directory);
  }
}
for (const name of expectedPackages)
  if (!packages.has(name))
    throw new Error(`Missing bundled dependency license: ${name}`);
const sections = [
  "# Bundled third-party notices\n\nGenerated from packages included in the reader and MCP server.",
];
for (const { pkg, text: license } of [...packages.values()].sort((a, b) =>
  a.pkg.name.localeCompare(b.pkg.name),
)) {
  sections.push(
    `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? "see text"}\n\n${license.trim()}`,
  );
}
await writeFile("THIRD_PARTY_NOTICES.md", sections.join("\n\n") + "\n");
console.log(
  `Built CodeMap Tour ${manifest.version}; ${packages.size} dependency licenses included.`,
);
