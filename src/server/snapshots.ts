import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { structuredPatch } from "diff";
import { z } from "zod";
import type {
  FileChange,
  Scenario,
  Selection,
  Side,
  SourceRef,
} from "../shared/model";
import {
  scenarioSchema,
  selectionSchema,
  sourceRefSchema,
  taskContextSchema,
} from "../shared/model";

import {
  lineCommentSchema,
  lineNoteInputSchema,
  type LineComment,
} from "../shared/code-comments";

const execute = promisify(execFile);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOUR_BYTES = 8 * 1024 * 1024;
const sensitiveName =
  /^(?:\.env(?:\.|$)|\.npmrc$|\.netrc$|id_(?:rsa|dsa|ed25519)$|credentials(?:\.|$))/i;
const sensitiveExtension = /\.(?:pem|p12|pfx|key|sqlite|sqlite3|db)$/i;

const citationSchema = z
  .object({
    path: z.string().min(1).max(2000),
    revision: z.string().min(1).max(200).default("WORKTREE"),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict()
  .refine(
    (ref) => ref.endLine >= ref.startLine && ref.endLine - ref.startLine < 150,
    {
      message:
        "A highlighted range must be ordered and contain at most 150 lines.",
    },
  );

const rangeInputSchema = z
  .object({
    path: z.string().min(1).max(2000).optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.endLine >= range.startLine, {
    message: "Important lines must be ordered.",
  });
const sideSourceSchema = z.union([
  citationSchema,
  z.array(citationSchema).min(1).max(8),
]);

function evidenceFor(refs: SourceRef[], sourcePath?: string) {
  if (!sourcePath && new Set(refs.map((ref) => ref.path)).size > 1)
    throw new Error("Specify a path for a chapter with multiple files.");
  const ref = sourcePath
    ? refs.find((ref) => ref.path === sourcePath)
    : refs[0];
  if (!ref)
    throw new Error("The file is not cited on this side of the chapter.");
  return ref;
}
function importantRefs(
  refs: SourceRef[],
  ranges: z.output<typeof rangeInputSchema>[],
) {
  return ranges.map((range) => {
    const ref = evidenceFor(refs, range.path);
    if (
      !refs.some(
        (candidate) =>
          identity(candidate) === identity(ref) &&
          range.startLine >= candidate.startLine &&
          range.endLine <= candidate.endLine,
      )
    )
      throw new Error("Happy Path must stay within the cited chapter ranges.");
    return { ...ref, startLine: range.startLine, endLine: range.endLine };
  });
}

const stopSchema = z
  .object({
    label: z.string().min(1).max(200),
    detail: z.string().max(2000),
    explanation: z.string().trim().min(1).max(6000).optional(),
    happyPath: z
      .array(rangeInputSchema.safeExtend({ side: z.enum(["before", "after"]) }))
      .max(80)
      .default([]),
    comments: z
      .array(
        lineNoteInputSchema.safeExtend({ side: z.enum(["before", "after"]) }),
      )
      .max(20)
      .default([]),
    before: sideSourceSchema.optional(),
    after: sideSourceSchema.optional(),
  })
  .strict()
  .refine((stop) => !!stop.before || !!stop.after, {
    message: "Each stop needs at least one source citation.",
  });

export const tourInputSchema = z
  .object({
    repository: z.string().min(1).max(4096),
    title: z.string().min(1).max(200),
    taskContext: taskContextSchema.optional(),
    stops: z.array(stopSchema).min(1).max(30),
  })
  .strict();
export const tourNotesSchema = z
  .object({
    taskContext: taskContextSchema.optional(),
    steps: z
      .array(
        z
          .object({
            stepId: z.string(),
            detail: z.string().max(2000).optional(),
            explanation: z.string().trim().min(1).max(6000).optional(),
            happyPath: z.array(rangeInputSchema).max(80).optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict();
export type TourInput = z.input<typeof tourInputSchema>;
type Citation = z.output<typeof citationSchema>;
type Captured = {
  revision: string;
  path: string;
  blob: string;
  lines: string[];
  content: string;
};
export type TourView = {
  review: { id: string; files: FileChange[] };
  scenario: Scenario;
  chapterOrder: string[];
  selection: Selection;
  version: number;
  lineComments: LineComment[];
  context?: { threadId?: string; repository: string; createdAt: string };
};

const identity = (ref: Pick<SourceRef, "revision" | "path" | "blob">) =>
  JSON.stringify([ref.revision, ref.path, ref.blob]);

const storedSchema = z.object({
  schema: z.literal(1),
  view: z.object({
    review: z.object({
      id: z.string().uuid(),
      files: z
        .array(
          z.object({
            path: z.string(),
            previousPath: z.string().optional(),
            status: z.enum(["added", "removed", "modified", "moved"]),
            category: z.enum([
              "production",
              "test",
              "configuration",
              "documentation",
              "asset",
            ]),
            before: sourceRefSchema.optional(),
            after: sourceRefSchema.optional(),
            added: z.number(),
            removed: z.number(),
          }),
        )
        .max(480),
    }),
    scenario: scenarioSchema,
    chapterOrder: z.array(z.string()).max(30),
    selection: selectionSchema,
    version: z.number().int().positive(),
    lineComments: z.array(lineCommentSchema).max(600).default([]),
    context: z
      .object({
        threadId: z.string().optional(),
        repository: z.string(),
        createdAt: z.string(),
      })
      .optional(),
  }),
  captures: z
    .array(
      z.object({
        revision: z.string(),
        path: z.string(),
        blob: z.string(),
        content: z.string().max(MAX_FILE_BYTES),
      }),
    )
    .max(480),
});

function validatePath(value: string) {
  const parts = value.split("/");
  if (
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part === ".git" ||
        sensitiveName.test(part) ||
        sensitiveExtension.test(part),
    )
  )
    throw new Error("The source path is not an allowed repository file.");
  return parts;
}

const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
Object.assign(gitEnv, {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
});

async function git(
  cwd: string,
  args: string[],
  maxBuffer = 2 * MAX_FILE_BYTES,
) {
  const result = await execute("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    env: gitEnv,
    encoding: "buffer",
    maxBuffer,
    timeout: 15000,
  });
  return result.stdout;
}

async function findRoot(repository: string) {
  if (!path.isAbsolute(repository))
    throw new Error("The repository path must be absolute.");
  const directory = await realpath(repository);
  const root = (await git(directory, ["rev-parse", "--show-toplevel"], 8192))
    .toString("utf8")
    .trim();
  return realpath(root);
}

async function readWorkingTree(root: string, parts: string[]) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Symbolic links are not captured.");
  }
  const resolved = await realpath(current);
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("The source file is outside the repository.");
  const handle = await open(
    resolved,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw new Error("Source must be a text file under 1 MiB.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readCommit(root: string, ref: Citation) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/~-]*$/.test(ref.revision) ||
    ref.revision.includes("..")
  )
    throw new Error("Invalid Git revision.");
  const commit = (
    await git(
      root,
      ["rev-parse", "--verify", "--end-of-options", `${ref.revision}^{commit}`],
      1024,
    )
  )
    .toString("utf8")
    .trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit))
    throw new Error("Revision did not resolve to a commit.");
  const tree = (
    await git(
      root,
      ["--literal-pathspecs", "ls-tree", "-z", commit, "--", ref.path],
      8192,
    )
  ).toString("utf8");
  const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(
    tree,
  );
  if (!match || match[3] !== ref.path)
    throw new Error("The cited file is unavailable at that revision.");
  const size = Number(
    (await git(root, ["cat-file", "-s", match[2]], 128))
      .toString("utf8")
      .trim(),
  );
  if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES)
    throw new Error("Source must be a text file under 1 MiB.");
  return { commit, data: await git(root, ["cat-file", "blob", match[2]]) };
}

function decode(data: Buffer) {
  if (data.length > MAX_FILE_BYTES || data.includes(0))
    throw new Error("Binary or oversized source is not supported.");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      data,
    );
  } catch {
    throw new Error("Source must be valid UTF-8 text.");
  }
}

export class TourSession {
  private view?: TourView;
  private captures = new Map<string, Captured>();
  private counter = 0;
  private stamp = "";

  constructor(
    private readonly stateFile?: string,
    private readonly threadId?: string,
  ) {}

  private refresh() {
    if (!this.stateFile) return;
    let stat;
    try {
      stat = lstatSync(this.stateFile);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    if (!stat.isFile() || stat.size > 64 * MAX_FILE_BYTES)
      throw new Error("The saved tour is unavailable.");
    const stamp = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
    if (stamp === this.stamp) return;
    const stored = storedSchema.parse(
      JSON.parse(readFileSync(this.stateFile, "utf8")),
    );
    const captures = new Map<string, Captured>();
    let bytes = 0;
    for (const value of stored.captures) {
      bytes += Buffer.byteLength(value.content);
      if (
        bytes > MAX_TOUR_BYTES ||
        createHash("sha256").update(value.content).digest("hex") !== value.blob
      )
        throw new Error("The saved source snapshot is invalid.");
      captures.set(identity(value), {
        ...value,
        lines: value.content.split("\n"),
      });
    }
    this.captures = captures;
    this.view = stored.view;
    this.counter = Math.max(this.counter, stored.view.version);
    this.stamp = stamp;
  }

  saveTo(stateFile: string) {
    this.persist(stateFile);
  }

  private persist(stateFile = this.stateFile) {
    if (!stateFile) return;
    mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    const captures = [...this.captures.values()].map(
      ({ lines, ...capture }) => capture,
    );
    writeFileSync(
      temporary,
      JSON.stringify({ schema: 1, view: this.view, captures }),
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    renameSync(temporary, stateFile);
    if (stateFile !== this.stateFile) return;
    const stat = lstatSync(this.stateFile);
    this.stamp = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  }

  async publish(value: unknown) {
    this.refresh();
    const input = tourInputSchema.parse(value);
    const root = await findRoot(input.repository);
    const captures = new Map<string, Captured>();
    const cache = new Map<string, Captured>();
    let bytes = 0;
    const read = async (ref: Citation) => {
      const parts = validatePath(ref.path);
      const key = JSON.stringify([ref.revision, ref.path]);
      let captured = cache.get(key);
      if (!captured) {
        const result =
          ref.revision === "WORKTREE"
            ? { commit: "", data: await readWorkingTree(root, parts) }
            : await readCommit(root, ref);
        bytes += result.data.length;
        if (bytes > MAX_TOUR_BYTES)
          throw new Error("The tour exceeds the source snapshot limit.");
        const content = decode(result.data);
        const blob = createHash("sha256").update(result.data).digest("hex");
        captured = {
          revision: result.commit || `worktree:${blob}`,
          path: ref.path,
          blob,
          lines: content.split("\n"),
          content,
        };
        cache.set(key, captured);
        captures.set(identity(captured), captured);
      }
      if (ref.endLine > captured.lines.length)
        throw new Error(`The cited lines are outside ${ref.path}.`);
      return {
        revision: captured.revision,
        path: ref.path,
        blob: captured.blob,
        startLine: ref.startLine,
        endLine: ref.endLine,
      };
    };
    const before: Scenario["before"] = [];
    const after: Scenario["after"] = [];
    const files: FileChange[] = [];
    const chapterOrder: string[] = [];
    const lineComments: LineComment[] = [];
    for (const [index, stop] of input.stops.entries()) {
      const key = `stop-${index + 1}`;
      chapterOrder.push(key);
      const readSide = async (value: Citation | Citation[] | undefined) => {
        const refs: SourceRef[] = [];
        for (const citation of value
          ? Array.isArray(value)
            ? value
            : [value]
          : [])
          refs.push(await read(citation));
        if (
          refs.some((ref) =>
            refs.some(
              (other) =>
                other.path === ref.path && identity(other) !== identity(ref),
            ),
          )
        )
          throw new Error(
            "Use before/after for different revisions of the same file.",
          );
        return refs;
      };
      const beforeRefs = await readSide(stop.before);
      const afterRefs = await readSide(stop.after);
      for (const [side, refs] of [
        ["before", beforeRefs],
        ["after", afterRefs],
      ] as const) {
        if (!refs.length) {
          if (stop.happyPath.some((range) => range.side === side))
            throw new Error("Happy Path needs source on its selected side.");
          continue;
        }
        const step = {
          id: `${key}-${side}`,
          from: "code",
          to: "reader",
          label: stop.label,
          detail: stop.detail,
          explanation: stop.explanation,
          happyPath: importantRefs(
            refs,
            stop.happyPath.filter((range) => range.side === side),
          ),
          kind: "state" as const,
          correspondence: key,
          evidence: refs,
          provenance: "inferred" as const,
        };
        (side === "before" ? before : after).push(step);
      }
      for (const comment of stop.comments) {
        const { side, ...inputNote } = comment;
        const note = lineNoteInputSchema.parse(inputNote);
        const ref = evidenceFor(
          side === "before" ? beforeRefs : afterRefs,
          note.path,
        );
        const endLine = note.endLine ?? note.startLine;
        if (endLine > captures.get(identity(ref))!.lines.length)
          throw new Error("Comment lines are outside the captured file.");
        lineComments.push({
          id: randomUUID(),
          stepId: `${key}-${side}`,
          ref: { ...ref, startLine: note.startLine, endLine },
          text: note.text,
        });
      }
      const full = (ref: SourceRef | undefined) => {
        if (!ref) return undefined;
        const capture = captures.get(identity(ref))!;
        return { ...ref, startLine: 1, endLine: capture.lines.length };
      };
      const pairs: { before?: SourceRef; after?: SourceRef }[] = [];
      for (const ref of beforeRefs) {
        if (pairs.some((pair) => pair.before?.path === ref.path)) continue;
        pairs.push({
          before: ref,
          after: afterRefs.find((candidate) => candidate.path === ref.path),
        });
      }
      for (const ref of afterRefs) {
        if (pairs.some((pair) => pair.after?.path === ref.path)) continue;
        if (
          beforeRefs.length === 1 &&
          afterRefs.length === 1 &&
          pairs.length === 1
        )
          pairs[0].after = ref;
        else pairs.push({ after: ref });
      }
      for (const pair of pairs) {
        const item: FileChange = {
          path: pair.after?.path ?? pair.before!.path,
          previousPath: pair.before?.path,
          status:
            pair.before && pair.after
              ? "modified"
              : pair.after
                ? "added"
                : "removed",
          category: "production",
          before: full(pair.before),
          after: full(pair.after),
          added: 0,
          removed: 0,
        };
        if (
          !files.some(
            (file) =>
              JSON.stringify([file.before, file.after]) ===
              JSON.stringify([item.before, item.after]),
          )
        )
          files.push(item);
      }
    }
    const first =
      after.find((step) => step.correspondence === chapterOrder[0]) ??
      before.find((step) => step.correspondence === chapterOrder[0])!;
    const side: Side = after.includes(first) ? "after" : "before";
    const scenario: Scenario = {
      id: "tour",
      storyId: "tour",
      title: input.title,
      summary: "",
      taskContext: input.taskContext,
      participants: [
        { id: "code", label: "Code" },
        { id: "reader", label: "Reader" },
      ],
      before,
      after,
      questions: [],
      provenance: "inferred",
    };
    this.captures = captures;
    this.view = {
      review: { id: randomUUID(), files },
      scenario,
      chapterOrder,
      lineComments,
      selection: {
        view: "flow",
        storyId: "tour",
        scenarioId: "tour",
        stepId: first.id,
        side,
      },
      version: ++this.counter,
      context: {
        threadId: this.threadId,
        repository: root,
        createdAt: new Date().toISOString(),
      },
    };
    this.persist();
    return this.current()!;
  }

  current() {
    this.refresh();
    return this.view ? structuredClone(this.view) : null;
  }

  navigate(tourId: string, stepId: string, side: Side) {
    const view = this.require(tourId);
    if (!view.scenario[side].some((step) => step.id === stepId))
      throw new Error("Unknown tour step.");
    if (view.selection.stepId !== stepId || view.selection.side !== side) {
      view.selection = {
        view: "flow",
        storyId: "tour",
        scenarioId: "tour",
        stepId,
        side,
      };
      view.version = ++this.counter;
      this.persist();
    }
    return this.current()!;
  }

  describe(tourId: string, notes: z.input<typeof tourNotesSchema>) {
    const view = this.require(tourId);
    const input = tourNotesSchema.parse(notes);
    const steps = [...view.scenario.before, ...view.scenario.after];
    for (const note of input.steps)
      if (!steps.some((step) => step.id === note.stepId))
        throw new Error("Unknown tour step.");
    const paths = new Map(
      input.steps
        .filter((note) => note.happyPath !== undefined)
        .map((note) => [
          note.stepId,
          importantRefs(
            steps.find((step) => step.id === note.stepId)!.evidence,
            note.happyPath!,
          ),
        ]),
    );
    for (const note of input.steps) {
      const step = steps.find((step) => step.id === note.stepId)!;
      if (paths.has(note.stepId)) step.happyPath = paths.get(note.stepId);
      if (note.detail !== undefined) step.detail = note.detail;
      if (note.explanation !== undefined) step.explanation = note.explanation;
    }
    if (input.taskContext) view.scenario.taskContext = input.taskContext;
    view.version = ++this.counter;
    this.persist();
    return this.current()!;
  }

  annotate(tourId: string, stepId: string, notes: unknown) {
    const view = this.require(tourId);
    const step = [...view.scenario.before, ...view.scenario.after].find(
      (step) => step.id === stepId,
    );
    if (!step) throw new Error("Unknown tour step.");
    const comments = z
      .array(lineNoteInputSchema)
      .max(20)
      .parse(notes)
      .map((note) => {
        const ref = evidenceFor(step.evidence, note.path);
        const captured = this.get(ref);
        const endLine = note.endLine ?? note.startLine;
        if (endLine > captured.lines.length)
          throw new Error("Comment lines are outside the captured file.");
        return {
          id: randomUUID(),
          stepId,
          ref: { ...ref, startLine: note.startLine, endLine },
          text: note.text,
        };
      });
    view.lineComments = [
      ...view.lineComments.filter((note) => note.stepId !== stepId),
      ...comments,
    ];
    view.version = ++this.counter;
    this.persist();
    return this.current()!;
  }

  source(tourId: string, ref: SourceRef, context: number, limit: number) {
    this.require(tourId);
    const captured = this.get(ref);
    if (
      ref.startLine < 1 ||
      ref.endLine < ref.startLine ||
      ref.endLine > captured.lines.length
    )
      throw new Error("Invalid source range.");
    const startLine = Math.max(1, ref.startLine - context);
    const endLine = Math.min(
      captured.lines.length,
      ref.endLine + context,
      startLine + limit - 1,
    );
    return {
      content: captured.lines.slice(startLine - 1, endLine).join("\n"),
      startLine,
      endLine,
      totalLines: captured.lines.length,
      truncated:
        endLine < Math.min(captured.lines.length, ref.endLine + context),
    };
  }

  diff(tourId: string, before: SourceRef, after: SourceRef) {
    this.require(tourId);
    const a = this.get(before),
      b = this.get(after);
    const patch = structuredPatch(
      a.path,
      b.path,
      a.content,
      b.content,
      "",
      "",
      { context: 3 },
    );
    let remaining = 800;
    let truncated = false;
    const hunks = [];
    for (const hunk of patch.hunks) {
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const lines = hunk.lines.slice(0, remaining);
      if (lines.length < hunk.lines.length) truncated = true;
      hunks.push({ oldStart: hunk.oldStart, newStart: hunk.newStart, lines });
      remaining -= lines.length;
    }
    return { hunks, truncated };
  }

  private require(tourId: string) {
    this.refresh();
    if (!this.view || this.view.review.id !== tourId)
      throw new Error("The tour is no longer active.");
    return this.view;
  }
  private get(ref: Pick<SourceRef, "revision" | "path" | "blob">) {
    const captured = this.captures.get(identity(ref));
    if (!captured)
      throw new Error("The source is not part of the active tour.");
    return captured;
  }
}
