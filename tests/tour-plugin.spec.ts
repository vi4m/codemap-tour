import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixture } from "./helpers";

test("conversation-panel app bridge renders the reader and keeps the selected code in sync", async ({
  page,
}) => {
  test.setTimeout(60000);
  execFileSync(process.execPath, ["scripts/build.mjs"]);
  const f = await fixture();
  const client = new Client({ name: "tour-browser-test", version: "1" });
  try {
    await f.write(
      "src/value.ts",
      "export function answer() {\n  return 1;\n}\n",
    );
    await f.write(
      "src/worker.ts",
      "// Context\n".repeat(50) + "export function work() {\n  return 3;\n}\n",
    );
    const base = await f.commit("base");
    await f.write(
      "src/value.ts",
      "export function answer() {\n  return 2;\n}\n",
    );
    const config = JSON.parse(
      await readFile("plugins/codemap-tour/test-mcp.json", "utf8"),
    );
    await client.connect(
      new StdioClientTransport({
        ...config.mcpServers["codemap-tour"],
        env: {
          ...(process.env as Record<string, string>),
          ...config.mcpServers["codemap-tour"].env,
          CODEMAP_TOUR_DATA_DIR: `${f.root}/tour-data`,
        },
        stderr: "pipe",
      }),
    );
    const citation = { path: "src/value.ts", startLine: 1, endLine: 3 };
    const published = await client.callTool({
      name: "tour_publish",
      _meta: { threadId: "browser-test-thread" },
      arguments: {
        repository: f.repo,
        title: "A code tour",
        taskContext: {
          goal: "Explain the changed return value.",
          changes: ["One becomes two."],
          additions: ["A line comment."],
          approach: ["Compare captured versions."],
        },
        stops: [
          {
            label: "One became two",
            detail: "The value changed.",
            explanation:
              "The captured after version returns two. This avoids reading a later working-tree edit as if it belonged to the original change.",
            before: { ...citation, revision: base },
            after: citation,
            happyPath: [{ side: "after", startLine: 2, endLine: 2 }],
            comments: [
              {
                side: "after",
                startLine: 1,
                text: "Function signature; outside the essential return.",
              },
              {
                side: "after",
                startLine: 2,
                text: "Two is returned immediately; no mutation is performed.",
              },
            ],
          },
          {
            label: "Return value",
            detail: "Look at the new return.",
            before: [
              { ...citation, revision: base },
              {
                path: "src/worker.ts",
                revision: base,
                startLine: 51,
                endLine: 53,
              },
            ],
            after: [
              citation,
              { path: "src/worker.ts", startLine: 51, endLine: 53 },
            ],
            happyPath: [
              { side: "after", path: "src/value.ts", startLine: 2, endLine: 2 },
              {
                side: "after",
                path: "src/worker.ts",
                startLine: 52,
                endLine: 52,
              },
            ],
            comments: [
              {
                side: "after",
                path: "src/worker.ts",
                startLine: 52,
                text: "Worker result belongs to this same logical change.",
              },
            ],
          },
        ],
      },
    });
    expect(published.isError).not.toBeTruthy();
    const tools = await client.listTools();
    const resourceUri = (
      tools.tools.find((tool) => tool.name === "tour_open")!._meta?.ui as {
        resourceUri: string;
      }
    ).resourceUri;
    const resource = await client.readResource({ uri: resourceUri });
    const entry = resource.contents[0];
    if (!("text" in entry)) throw new Error("Expected an HTML resource.");
    const html = entry.text;
    const host = await build({
      entryPoints: ["tests/tour-plugin-host.ts"],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "chrome114",
      write: false,
    });
    let routedThread = "browser-test-thread";
    await page.route("**/tour-test-mcp", async (route) => {
      const params = route.request().postDataJSON();
      if (routedThread === "legacy-backend") {
        const result = await client.callTool({
          ...params,
          _meta: { threadId: "browser-test-thread" },
        });
        const legacy = {
          ...result,
          structuredContent: { tour: (result.structuredContent as any)?.tour },
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(legacy),
        });
        return;
      }
      const result = await client.callTool({
        ...params,
        _meta: { threadId: routedThread },
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    });
    await page.route("**/tour-test-host", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><iframe sandbox="allow-scripts" style="width:660px;height:850px;border:0"></iframe>',
      }),
    );
    await page.goto("/tour-test-host");
    await page.evaluate((value) => {
      (window as any).tourHtml = value;
    }, html);
    await page.addScriptTag({ content: host.outputFiles[0].text });
    const reader = page.frameLocator("iframe");
    await expect(
      reader.getByRole("region", { name: "Code tour" }),
    ).toBeVisible();
    await expect(
      reader.locator(".cm-tour-focus").filter({ hasText: "return 2" }),
    ).toHaveCount(1);
    await expect(reader.locator(".tour-note")).toContainText("One became two");
    await expect(reader.getByLabel("Source directory")).toHaveText(
      "src/value.ts",
    );
    await expect(
      reader.getByLabel("Line comments", { exact: true }),
    ).toContainText("2 comments");
    await expect(reader.getByLabel("Overall task context")).toHaveCount(0);
    await reader
      .getByRole("button", { name: "Task context", exact: true })
      .hover();
    await expect(reader.getByLabel("Overall task context")).toContainText(
      "Compare captured versions.",
    );
    await reader
      .getByRole("button", { name: "Task context", exact: true })
      .click();
    await reader
      .getByRole("button", { name: "Happy Path", exact: true })
      .hover();
    await expect(reader.getByLabel("Overall task context")).toBeVisible();
    await reader.getByRole("button", { name: "Close task context" }).click();
    await expect(
      reader.getByRole("button", { name: "Happy Path", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(reader.locator(".cm-happy-dim")).toHaveCount(0);
    await reader
      .getByRole("button", { name: "Happy Path", exact: true })
      .click();
    await expect(reader.locator(".cm-happy-dim").first()).toBeVisible();
    await expect(
      reader.locator(".cm-tour-focus").filter({ hasText: "return 2" }),
    ).not.toHaveClass(/cm-happy-dim/);
    await expect(
      reader.locator(".cm-tour-focus").filter({ hasText: "export function" }),
    ).toHaveClass(/cm-happy-dim/);
    await expect(
      reader.getByRole("button", { name: "Comment on line 1", exact: true }),
    ).toBeVisible();
    await reader
      .getByRole("button", { name: "Happy Path visual options" })
      .click();
    await reader
      .getByRole("menuitemradio", { name: "Blur", exact: true })
      .click();
    await expect(reader.locator(".cm-happy-blur").first()).toBeVisible();
    await reader
      .getByRole("button", { name: "Happy Path visual options" })
      .click();
    await reader.getByRole("menuitemradio", { name: "Hide with gaps" }).click();
    await expect(reader.locator(".cm-happy-gap").first()).toContainText(
      "hidden",
    );
    await expect(reader.locator(".cm-tour-focus")).toContainText("return 2");
    await reader.locator(".cm-happy-gap").first().getByRole("button").click();
    await expect(
      reader.getByRole("button", { name: "Happy Path", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(reader.locator(".cm-happy-gap")).toHaveCount(0);
    const note = reader.getByLabel("Step explanation");
    const noteBox = await note.boundingBox();
    const handle = await reader
      .getByRole("button", { name: "Move guide note" })
      .boundingBox();
    if (!noteBox || !handle)
      throw new Error("Expected a draggable guide note.");
    await page.mouse.move(handle.x + 40, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + 40 + (28 - noteBox.x),
      handle.y + 10 + (358 - noteBox.y),
      {
        steps: 8,
      },
    );
    await page.mouse.up();
    expect((await note.boundingBox())!.x).toBeLessThan(100);
    await expect(
      note.getByText("The captured after version returns two.", {
        exact: false,
      }),
    ).not.toBeVisible();
    await note.getByText("Read more", { exact: true }).click();
    await expect(note).toContainText(
      "This avoids reading a later working-tree edit",
    );
    const positionBeforeSelect = await note.boundingBox();

    await expect(
      reader.getByRole("button", { name: "Comment on line 2", exact: true }),
    ).toBeVisible();
    await reader
      .locator(".cm-line")
      .filter({ hasText: "return 2" })
      .hover({ position: { x: 75, y: 12 } });
    await expect(reader.getByRole("tooltip")).toContainText(
      "no mutation is performed",
    );
    await reader
      .getByRole("tooltip")
      .getByRole("button", { name: "Discuss this line" })
      .click();
    await expect(reader.getByLabel("Discuss selected code")).toContainText(
      "L2",
    );
    await expect(note).toBeVisible();
    expect(
      Math.abs((await note.boundingBox())!.x - positionBeforeSelect!.x),
    ).toBeLessThan(2);
    await expect(
      reader.getByLabel("Question about selected lines"),
    ).toHaveValue("Explain me this more");
    await reader
      .getByLabel("Question template")
      .selectOption("explain me step by step how it works");
    await expect(
      reader.getByLabel("Question about selected lines"),
    ).toHaveValue("explain me step by step how it works");
    await reader
      .getByLabel("Question template")
      .selectOption("Is that really needed?");
    await expect(
      reader.getByLabel("Question about selected lines"),
    ).toHaveValue("Is that really needed?");
    await page
      .locator("iframe")
      .screenshot({
        path: test.info().outputPath("guide-and-line-discussion.png"),
      });

    await reader
      .getByLabel("Question about selected lines")
      .fill("Why is this an immediate return?");
    await reader
      .getByRole("button", { name: "Discuss in Codex", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).tourRawMessage))
      .toMatchObject({
        _meta: { "openai/message": { target: "active", send: false } },
      });
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourRawMessage?.content[0].text),
      )
      .toContain("Why is this an immediate return?");
    const message = await page.evaluate(
      () => (window as any).tourRawMessage.content[0].text,
    );
    expect(message).toContain("src/value.ts:L2–2");
    expect(message).toContain("return 2;");
    expect(message).toContain("Revision: worktree:");
    expect(message).not.toContain("return 1;");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourContext?.content?.[0]?.text),
      )
      .toContain("src/value.ts:L2–2");
    await reader.getByRole("button", { name: "Close line discussion" }).click();
    await reader.getByRole("button", { name: "Before", exact: true }).click();
    await expect(
      reader.locator(".cm-line").filter({ hasText: "return 1" }),
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: "Comment on line 2", exact: true }),
    ).toHaveCount(0);
    await reader.getByRole("button", { name: "After", exact: true }).click();
    await expect(
      reader.locator(".cm-line").filter({ hasText: "return 2" }),
    ).toBeVisible();
    // Native DOM selection in a read-only editor must select actual source lines too.
    const code = reader.locator(".cm-line").filter({ hasText: "return 2" });
    await code.click();
    await expect(reader.getByLabel("Discuss selected code")).toContainText(
      "L2",
    );
    await reader.getByRole("button", { name: "Close line discussion" }).click();
    const firstCode = await reader
      .locator(".cm-line")
      .filter({ hasText: "export function" })
      .boundingBox();
    const secondCode = await code.boundingBox();
    if (!firstCode || !secondCode) throw new Error("Expected source lines.");
    const gutter = await reader.locator(".cm-gutters").boundingBox();
    if (!gutter) throw new Error("Expected line numbers.");
    await page.mouse.move(gutter.x + gutter.width + 12, firstCode.y + 12);
    await page.mouse.down();
    await page.mouse.move(gutter.x + gutter.width + 100, secondCode.y + 12, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(reader.getByLabel("Discuss selected code")).toContainText(
      "L1–2",
    );
    expect(
      await code.evaluate(
        (el) =>
          getComputedStyle(el.querySelector("span") ?? el, "::selection")
            .backgroundColor,
      ),
    ).toBe("rgb(56, 83, 111)");
    await page
      .locator("iframe")
      .screenshot({ path: test.info().outputPath("dark-text-selection.png") });
    await reader
      .getByRole("button", { name: "Discuss in Codex", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourRawMessage?.content[0].text),
      )
      .toContain("src/value.ts:L1–2");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourRawMessage?.content[0].text),
      )
      .toContain("export function answer()");
    await reader.getByRole("button", { name: "Close line discussion" }).click();
    await reader.getByRole("button", { name: "Diff", exact: true }).click();
    await expect(reader.getByLabel("Code diff")).toContainText("return 1");
    await expect(reader.getByLabel("Code diff")).toContainText("return 2");
    await reader.getByRole("button", { name: "Diff", exact: true }).click();
    await reader.getByRole("button", { name: "Play auto advance" }).click();
    await expect(
      reader.getByRole("button", { name: "Pause auto advance" }),
    ).toBeVisible();
    await expect(reader.locator(".tour-note")).toContainText("Return value", {
      timeout: 15000,
    });
    await reader.getByRole("button", { name: "Pause auto advance" }).click();
    await reader.getByRole("button", { name: "Previous step" }).click();
    await reader.getByRole("button", { name: "Next step" }).click();
    await expect
      .poll(
        async () =>
          (
            (
              await client.callTool({
                name: "tour_state",
                arguments: {},
                _meta: { threadId: "browser-test-thread" },
              })
            ).structuredContent as {
              tour: unknown;
            }
          ).tour,
      )
      .toMatchObject({ selection: { stepId: "stop-2-after", side: "after" } });
    await reader
      .getByRole("button", { name: "Ask Codex about this step" })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).tourRawMessage))
      .toMatchObject({
        role: "user",
        _meta: { "openai/message": { target: "active", send: false } },
      });
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourContext?.content?.[0]?.text),
      )
      .toContain("Return value");
    await expect(reader.getByLabel("Files in this chapter")).toBeVisible();
    await reader
      .getByLabel("Files in this chapter")
      .getByRole("button", { name: /worker.ts/ })
      .click();
    await expect(reader.getByLabel("Source directory")).toHaveText(
      "src/worker.ts",
    );
    await expect(
      reader.getByRole("button", { name: "Comment on line 52", exact: true }),
    ).toBeVisible();
    await expect(
      reader.locator(".cm-tour-focus").filter({ hasText: "return 3" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourContext?.content?.[0]?.text),
      )
      .toContain("src/worker.ts");
    await reader
      .getByRole("button", { name: "Ask Codex about this step" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).tourRawMessage?.content[0]?.text),
      )
      .toContain("src/worker.ts");
    await reader.getByRole("button", { name: "Diff", exact: true }).click();
    await expect(reader.getByLabel("Code diff")).toContainText(
      "No textual changes",
    );
    await reader.getByRole("button", { name: "Diff", exact: true }).click();
    await reader
      .getByRole("button", { name: "Happy Path visual options" })
      .click();
    await reader
      .getByRole("menuitemradio", { name: "Dim", exact: true })
      .click();
    await expect(reader.locator(".cm-happy-key")).toContainText("return 3");
    await expect(
      reader.locator(".cm-tour-focus").filter({ hasText: "export function" }),
    ).toHaveClass(/cm-happy-dim/);
    await reader
      .getByRole("button", { name: "Happy Path", exact: true })
      .click();
    await reader
      .getByLabel("Files in this chapter")
      .getByRole("button", { name: /value.ts/ })
      .click();
    await expect(
      reader.locator(".cm-tour-focus").filter({ hasText: "return 2" }),
    ).toBeVisible();

    routedThread = "legacy-backend";
    await expect(reader.getByRole("status")).toContainText("older backend");
    await expect(
      reader.getByRole("button", {
        name: "Prepare tour for this conversation",
      }),
    ).toHaveCount(0);
    await expect(reader.getByRole("region", { name: "Code tour" })).toHaveCount(
      0,
    );
    routedThread = "another-conversation";
    await page.reload();
    await page.evaluate((value) => {
      (window as any).tourHtml = value;
    }, html);
    await page.addScriptTag({ content: host.outputFiles[0].text });
    await expect(reader.getByRole("region", { name: "Code tour" })).toHaveCount(
      0,
    );
    await expect(reader.getByRole("status")).toContainText(
      "another conversation",
    );
    await reader
      .getByRole("button", { name: "Prepare tour for this conversation" })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).tourRawMessage))
      .toMatchObject({
        _meta: { "openai/message": { target: "active", send: true } },
      });
  } finally {
    await client.close();
    await f.dispose();
  }
});
