import test from "node:test";
import { lineDiscussionText } from "../src/shared/code-comments";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, symlink } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixture } from "./helpers";
import { ConversationTours } from "../src/server/conversations";
import { TourSession, type TourView } from "../src/server/snapshots";

test("tour snapshots capture real revisions, stay stable, and reject unsafe source paths", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  await f.write(
    "src/answer.ts",
    "export function answer() {\n  return 1;\n}\n",
  );
  const base = await f.commit("base");
  await f.write(
    "src/answer.ts",
    "export function answer() {\n  return 2;\n}\n",
  );
  const session = new TourSession();
  const citation = { path: "src/answer.ts", startLine: 2, endLine: 2 };
  const input = {
    repository: f.repo,
    title: "Answer",
    stops: [
      {
        label: "Changed value",
        detail: "One became two.",
        explanation:
          "The worker now returns two after its input has been captured.",
        comments: [{ side: "after", startLine: 2, text: "The new value." }],
        before: { ...citation, revision: base },
        after: { ...citation, revision: "WORKTREE" },
      },
    ],
  };
  const tour = await session.publish(input);
  assert.equal(tour.lineComments.length, 1);
  assert.equal(tour.lineComments[0].stepId, "stop-1-after");
  assert.equal(
    tour.lineComments[0].ref.blob,
    tour.scenario.after[0].evidence[0].blob,
  );
  assert.throws(
    () =>
      session.annotate(tour.review.id, "stop-1-after", [
        { startLine: 200, text: "Outside" },
      ]),
    /outside/,
  );
  assert.equal(session.current()?.lineComments[0].text, "The new value.");
  const updated = session.annotate(tour.review.id, "stop-1-before", [
    { startLine: 1, endLine: 2, text: "Original return." },
  ]);
  assert.equal(updated.lineComments.length, 2);
  assert.equal(
    session.annotate(tour.review.id, "stop-1-before", []).lineComments.length,
    1,
  );
  assert.equal(
    tour.scenario.after[0].explanation,
    "The worker now returns two after its input has been captured.",
  );
  const described = session.describe(tour.review.id, {
    taskContext: { goal: "Explain the value.", changes: ["Return two."] },
    steps: [
      {
        stepId: "stop-1-after",
        detail: "Short note.",
        explanation: "A longer note with reasoning.",
      },
    ],
  });
  assert.equal(described.scenario.taskContext?.goal, "Explain the value.");
  assert.equal(described.scenario.after[0].detail, "Short note.");
  assert.equal(
    described.scenario.after[0].explanation,
    "A longer note with reasoning.",
  );
  assert.equal(described.lineComments.length, 1);
  assert.deepEqual(described.selection, session.current()?.selection);
  assert.throws(
    () =>
      session.describe(tour.review.id, {
        steps: [
          { stepId: "stop-1-after", detail: "Must not persist" },
          { stepId: "missing", detail: "Invalid" },
        ],
      }),
    /Unknown tour step/,
  );
  assert.equal(session.current()?.scenario.after[0].detail, "Short note.");
  const before = tour.scenario.before[0].evidence[0];
  const after = tour.scenario.after[0].evidence[0];
  await f.write(
    "src/answer.ts",
    "export function answer() {\n  return 3;\n}\n",
  );
  assert.match(
    session.source(tour.review.id, after, 1, 10).content,
    /return 2/,
  );
  const changes = session
    .diff(tour.review.id, before, after)
    .hunks.flatMap((hunk) => hunk.lines);
  assert.ok(changes.some((line) => line.includes("-  return 1")));
  assert.ok(changes.some((line) => line.includes("+  return 2")));
  assert.equal(
    session.navigate(tour.review.id, tour.scenario.before[0].id, "before")
      .selection.side,
    "before",
  );
  await assert.rejects(
    session.publish({
      ...input,
      stops: [
        { ...input.stops[0], after: { ...citation, path: "../outside" } },
      ],
    }),
    /not an allowed/,
  );
  await f.write(".env", "SECRET=value");
  await assert.rejects(
    session.publish({
      ...input,
      stops: [{ ...input.stops[0], after: { ...citation, path: ".env" } }],
    }),
    /not an allowed/,
  );
  await symlink("answer.ts", `${f.repo}/src/link.ts`);
  await assert.rejects(
    session.publish({
      ...input,
      stops: [
        { ...input.stops[0], after: { ...citation, path: "src/link.ts" } },
      ],
    }),
    /Symbolic/,
  );
  assert.equal(
    session.current()?.review.id,
    tour.review.id,
    "a failed publication must not replace the active tour",
  );
  const routing = new ConversationTours(`${f.root}/conversation-tours`);
  const a = await routing
    .forThread("thread-a")
    .publish({ ...input, title: "Tour A" });
  routing.remember(routing.forThread("thread-a"));
  assert.equal(routing.state({ _meta: { threadId: "thread-b" } }).tour, null);
  const b = await routing
    .forThread("thread-b")
    .publish({ ...input, title: "Tour B" });
  routing.remember(routing.forThread("thread-b"));
  const restored = new ConversationTours(`${f.root}/conversation-tours`);
  assert.equal(
    restored.forThread("thread-a").current()?.review.id,
    a.review.id,
  );
  assert.equal(
    restored.forThread("thread-b").current()?.review.id,
    b.review.id,
  );
  restored
    .forThread("thread-a")
    .annotate(a.review.id, "stop-1-after", [{ startLine: 2, text: "Only A" }]);
  const reopened = new ConversationTours(`${f.root}/conversation-tours`);
  assert.equal(
    reopened.forThread("thread-a").current()?.lineComments[0].text,
    "Only A",
  );
  assert.equal(
    reopened.forThread("thread-b").current()?.lineComments[0].text,
    "The new value.",
  );
  assert.throws(
    () =>
      reopened.forThread("thread-b").annotate(a.review.id, "stop-1-after", []),
    /no longer active/,
  );

  assert.throws(
    () =>
      restored
        .forThread("thread-b")
        .navigate(a.review.id, a.selection.stepId!, "after"),
    /no longer active/,
  );
});

test("the bundled MCP server advertises a native thread tab and serves a complete tour", async (t) => {
  execFileSync(process.execPath, ["scripts/build.mjs"]);
  const f = await fixture();
  t.after(f.dispose);
  await f.write("source.ts", "const value = 1;\n");
  const base = await f.commit("base");
  await f.write("source.ts", "const value = 2;\n");
  const client = new Client({ name: "tour-test", version: "1" });
  const call = (
    args: Parameters<typeof client.callTool>[0],
    threadId = "test-thread",
  ) => client.callTool({ ...args, _meta: { threadId } });
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
  t.after(() => client.close());
  const tools = await client.listTools();
  const panel = tools.tools.find((item) => item.name === "tour_panel")!;
  assert.deepEqual(panel._meta?.["openai/ui"], {
    entrypoints: [{ type: "global" }],
  });
  assert.deepEqual((panel._meta?.ui as { visibility: string[] }).visibility, [
    "app",
  ]);
  const reader = tools.tools.find((item) => item.name === "tour_open")!;
  assert.deepEqual(reader._meta?.["openai/ui"], {
    entrypoints: [{ type: "thread" }],
    preferredModelDisplayMode: "fullscreen",
  });
  assert.deepEqual(reader.inputSchema.properties, {});
  for (const name of [
    "tour_state",
    "tour_select",
    "tour_source",
    "tour_diff",
    "tour_annotate",
    "tour_describe",
  ]) {
    const tool = tools.tools.find((item) => item.name === name)!;
    assert.equal(
      (tool._meta?.ui as { resourceUri?: string }).resourceUri,
      undefined,
      "reading or navigating a tour must not open another widget",
    );
  }
  assert.deepEqual(panel.inputSchema.properties, {});
  assert.ok(
    config.mcpServers["codemap-tour"].args[0].endsWith("/0.1.9/server.mjs"),
  );
  const resource = await client.readResource({
    uri: (reader._meta?.ui as { resourceUri: string }).resourceUri,
  });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok("text" in resource.contents[0]);
  assert.match(resource.contents[0].text, /id="root"/);
  const citation = { path: "source.ts", startLine: 1, endLine: 1 };
  const published = await call({
    name: "tour_publish",
    arguments: {
      repository: f.repo,
      title: "Example",
      stops: [
        {
          label: "A value",
          detail: "The value changes.",
          before: { ...citation, revision: base },
          after: citation,
        },
      ],
    },
  });
  assert.equal(published.isError, undefined);
  const state = await call({ name: "tour_state", arguments: {} });
  const tour = (state.structuredContent as { tour: TourView }).tour;
  assert.equal(tour.scenario.title, "Example");
  const opened = await call({ name: "tour_open", arguments: {} });
  assert.equal(
    (opened.structuredContent as { tour: TourView }).tour.review.id,
    tour.review.id,
  );
  const sidebar = new ConversationTours(`${f.root}/tour-data`).forThread(
    "test-thread",
  );
  assert.equal(
    sidebar.current()?.review.id,
    tour.review.id,
    "readers in the same conversation share its tour",
  );
  sidebar.navigate(tour.review.id, tour.scenario.before[0].id, "before");
  const synchronized = await call({ name: "tour_state", arguments: {} });
  assert.equal(
    (synchronized.structuredContent as { tour: TourView }).tour.selection.side,
    "before",
  );
  const other = await call(
    { name: "tour_state", arguments: {} },
    "other-thread",
  );
  assert.equal((other.structuredContent as { tour: unknown }).tour, null);
  assert.equal(
    (other.structuredContent as { context: { hasOtherTour: boolean } }).context
      .hasOtherTour,
    true,
  );
  const foreign = await call(
    {
      name: "tour_source",
      arguments: {
        tourId: tour.review.id,
        ref: tour.scenario.after[0].evidence[0],
      },
    },
    "other-thread",
  );
  assert.equal(foreign.isError, true);
  const annotated = await call({
    name: "tour_annotate",
    arguments: {
      tourId: tour.review.id,
      stepId: "stop-1-after",
      comments: [{ startLine: 1, text: "Only the after snapshot." }],
    },
  });
  assert.equal(annotated.isError, undefined);
  assert.equal(
    (annotated.structuredContent as { tour: TourView }).tour.lineComments[0]
      .text,
    "Only the after snapshot.",
  );
  const rejectedAnnotation = await call(
    {
      name: "tour_annotate",
      arguments: {
        tourId: tour.review.id,
        stepId: "stop-1-after",
        comments: [],
      },
    },
    "other-thread",
  );
  assert.equal(rejectedAnnotation.isError, true);
  const described = await call({
    name: "tour_describe",
    arguments: {
      tourId: tour.review.id,
      taskContext: { goal: "Explain a return." },
      steps: [{ stepId: "stop-1-after", explanation: "A longer explanation." }],
    },
  });
  assert.equal(described.isError, undefined);
  assert.equal(
    (described.structuredContent as { tour: TourView }).tour.scenario.after[0]
      .explanation,
    "A longer explanation.",
  );
  const refusedDescription = await call(
    { name: "tour_describe", arguments: { tourId: tour.review.id, steps: [] } },
    "other-thread",
  );
  assert.equal(refusedDescription.isError, true);
  const source = await call({
    name: "tour_source",
    arguments: {
      tourId: tour.review.id,
      ref: tour.scenario.after[0].evidence[0],
    },
  });
  assert.match(
    String((source.structuredContent as { content: string }).content),
    /value = 2/,
  );
  const invalid = await call({
    name: "tour_select",
    arguments: { tourId: tour.review.id, stepId: "missing", side: "after" },
  });
  assert.equal(invalid.isError, true);
});

test("line discussion keeps source fences quoted and bounds context without changing its identity", () => {
  const selected = {
    stepId: "stop-1-after",
    side: "after" as const,
    ref: {
      path: "source.ts",
      revision: "abc",
      blob: "def",
      startLine: 42,
      endLine: 44,
    },
    code: "```\nunsafe source\n```",
  };
  const text = lineDiscussionText("tour-id", selected, "Why?");
  assert.match(text, /source.ts:L42–44/);
  assert.ok(text.includes("    ```\n    unsafe source"));
  assert.ok(
    lineDiscussionText("tour-id", {
      ...selected,
      code: "a".repeat(12001),
    }).includes("Excerpt clipped"),
  );
});

test("one logical chapter captures multiple files and keeps essential ranges independent of comments", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  await f.write(
    "api.ts",
    "const request = 1;\nconst logging = true;\nconst result = work(request);\nreturn result;\n",
  );
  await f.write(
    "worker.ts",
    "export function work(value) {\n  return value + 1;\n}\n",
  );
  const base = await f.commit("base");
  const session = new TourSession(`${f.root}/multi.json`, "thread");
  const refs = [
    { path: "api.ts", startLine: 1, endLine: 4 },
    { path: "worker.ts", startLine: 1, endLine: 3 },
  ];
  const input = {
    repository: f.repo,
    title: "API to worker",
    stops: [
      {
        label: "One operation",
        detail: "Read the request and return the worker result.",
        before: refs.map((ref) => ({ ...ref, revision: base })),
        after: refs,
        happyPath: [
          { side: "after", path: "api.ts", startLine: 3, endLine: 4 },
          { side: "after", path: "worker.ts", startLine: 2, endLine: 2 },
        ],
        comments: [
          {
            side: "after",
            path: "api.ts",
            startLine: 2,
            text: "Diagnostic only.",
          },
        ],
      },
    ],
  };
  const tour = await session.publish(input);
  assert.equal(tour.chapterOrder.length, 1);
  assert.equal(tour.scenario.after.length, 1);
  assert.equal(tour.scenario.after[0].evidence.length, 2);
  assert.deepEqual(
    tour.scenario.after[0].happyPath?.map((ref) => [
      ref.path,
      ref.startLine,
      ref.endLine,
    ]),
    [
      ["api.ts", 3, 4],
      ["worker.ts", 2, 2],
    ],
  );
  assert.equal(
    tour.lineComments[0].ref.startLine,
    2,
    "a comment does not declare a line essential",
  );
  assert.equal(tour.review.files.length, 2);
  assert.equal(tour.review.files[1].before?.path, "worker.ts");
  assert.equal(tour.review.files[1].after?.path, "worker.ts");
  assert.throws(
    () =>
      session.annotate(tour.review.id, "stop-1-after", [
        { startLine: 2, text: "Ambiguous" },
      ]),
    /Specify a path/,
  );
  session.annotate(tour.review.id, "stop-1-after", [
    { path: "worker.ts", startLine: 2, text: "Worker result." },
  ]);
  assert.equal(session.current()?.lineComments[0].ref.path, "worker.ts");
  assert.throws(
    () =>
      session.describe(tour.review.id, {
        steps: [
          {
            stepId: "stop-1-after",
            detail: "Do not persist",
            happyPath: [{ path: "worker.ts", startLine: 2, endLine: 200 }],
          },
        ],
      }),
    /within the cited/,
  );
  assert.equal(
    session.current()?.scenario.after[0].detail,
    tour.scenario.after[0].detail,
  );
  await assert.rejects(
    session.publish({
      ...input,
      stops: [
        {
          ...input.stops[0],
          happyPath: [{ side: "after", startLine: 2, endLine: 2 }],
        },
      ],
    }),
    /Specify a path/,
  );
  assert.equal(
    new TourSession(`${f.root}/multi.json`, "thread").current()?.scenario
      .after[0].evidence.length,
    2,
  );
  const noPath = await session.publish({
    ...input,
    stops: [{ ...input.stops[0], happyPath: [] }],
  });
  assert.deepEqual(
    noPath.scenario.after[0].happyPath,
    [],
    "the chapter evidence is never an automatic Happy Path",
  );
});
