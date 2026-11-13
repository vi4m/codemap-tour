import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
const root = path.resolve("plugins/codemap-tour");
const manifest = JSON.parse(await readFile(root + "/plugin.json", "utf8"));
const config = JSON.parse(await readFile(root + "/mcp.json", "utf8"))
  .mcpServers["codemap-tour"];
assert.equal(config.type, "stdio");
assert.ok(config.args.every((value) => !value.includes("/Users/")));
const args = config.args.map((value) =>
  value.replaceAll("${PLUGIN_ROOT}", root),
);
const client = new Client({ name: "distribution-smoke", version: "1" });
try {
  await client.connect(
    new StdioClientTransport({
      command: config.command,
      args,
      cwd: root,
      env: { ...process.env, ...config.env },
      stderr: "pipe",
    }),
  );
  const tools = await client.listTools();
  for (const name of [
    "tour_publish",
    "tour_open",
    "tour_source",
    "tour_annotate",
    "tour_describe",
  ])
    assert.ok(tools.tools.some((tool) => tool.name === name));
  const uri = tools.tools.find((tool) => tool.name === "tour_open")._meta.ui
    .resourceUri;
  const html = (await client.readResource({ uri })).contents[0].text;
  assert.ok(html.includes("Happy Path"));
  assert.ok(html.includes("Move guide note"));
  console.log(
    `Distribution smoke passed: ${manifest.name} ${manifest.version}, ${tools.tools.length} tools, self-contained reader.`,
  );
} finally {
  await client.close();
}
