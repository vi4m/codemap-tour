import { z } from "zod";

export const SCHEMA_VERSION = 2 as const;
export const ANALYZER_VERSION = "tree-sitter-v1.3";
export type Side = "before" | "after";
export type Category =
  "production" | "test" | "configuration" | "documentation" | "asset";
export type ChangeKind =
  | "added"
  | "removed"
  | "signature"
  | "implementation"
  | "moved"
  | "renamed"
  | "unchanged";
export type Provenance = "extracted" | "resolved" | "inferred";
export const sourceRefSchema = z
  .object({
    revision: z.string().min(1),
    blob: z.string().min(1),
    path: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict();
export type SourceRef = z.infer<typeof sourceRefSchema>;
export interface Snapshot {
  revision: string;
  label: string;
  commit?: string;
}
export interface Comparison {
  repository: string;
  repositoryId: string;
  repositoryName: string;
  base: Snapshot;
  head: Snapshot;
  mode: "commits" | "working-tree" | "pull-request";
  pullRequest?: {
    url: string;
    number: number;
    title: string;
    targetRevision: string;
  };
}
export interface SymbolVersion {
  name: string;
  qualifiedName: string;
  kind:
    | "module"
    | "class"
    | "struct"
    | "enum"
    | "interface"
    | "protocol"
    | "function"
    | "method"
    | "type";
  language: string;
  signature: string;
  bodyHash: string;
  shapeHash: string;
  parentKey?: string;
  source: SourceRef;
}
export interface CodeSymbol {
  id: string;
  before?: SymbolVersion;
  after?: SymbolVersion;
  changes: ChangeKind[];
  category: Category;
  matchNote?: string;
}
export interface Relationship {
  id: string;
  from: string;
  to?: string;
  target: string;
  kind: "contains" | "calls" | "imports" | "http" | "registers" | "route";
  provenance: Provenance;
  before?: SourceRef;
  after?: SourceRef;
  status: "added" | "removed" | "unchanged";
  detail?: string;
  uncertain?: string;
}
export interface FileChange {
  path: string;
  previousPath?: string;
  status: "added" | "removed" | "modified" | "moved";
  category: Category;
  before?: SourceRef;
  after?: SourceRef;
  language?: string;
  added: number;
  removed: number;
  gap?: string;
}
const text = z.string().max(12000);
export const storySchema = z
  .object({
    id: z.string().min(1).max(150),
    title: z.string().min(1).max(200),
    summary: text,
    trigger: text,
    before: text,
    after: text,
    category: z.enum([
      "production",
      "test",
      "configuration",
      "documentation",
      "asset",
    ]),
    filePaths: z.array(z.string()).max(500),
    symbolIds: z.array(z.string()).max(500),
    evidence: z.array(sourceRefSchema).max(100),
    questions: z.array(text).max(30),
    provenance: z.enum(["extracted", "inferred"]),
  })
  .strict();
export type ChangeStory = z.infer<typeof storySchema>;
export const orientationFileSchema = z
  .object({
    source: sourceRefSchema,
    change: z.enum(["added", "modified", "existing", "removed"]),
    purpose: z.string().trim().min(1).max(700),
    integration: z.string().trim().min(1).max(1200),
  })
  .strict();
export const orientationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).default("Mapa zmian"),
    summary: z.string().trim().min(1).max(2000),
    directories: z
      .array(
        z
          .object({
            path: z.string().min(1).max(2000),
            purpose: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    files: z.array(orientationFileSchema).min(1).max(20),
  })
  .strict();
export const glossaryEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum([
      "class",
      "struct",
      "enum",
      "interface",
      "protocol",
      "type",
      "function",
      "service",
      "concept",
    ]),
    isNew: z.boolean().default(true),
    responsibility: z.string().trim().min(1).max(1000),
    collaboration: z.string().trim().min(1).max(1500),
    source: sourceRefSchema,
  })
  .strict();
export const glossarySchema = z
  .object({
    title: z.string().trim().min(1).max(200).default("Słownik pojęć"),
    summary: z.string().trim().min(1).max(2000),
    entries: z.array(glossaryEntrySchema).min(1).max(20),
  })
  .strict();
export const introductionSchema = z
  .object({ orientation: orientationSchema, glossary: glossarySchema })
  .strict();
export const introductionStepSchema = z.discriminatedUnion("kind", [
  orientationSchema.extend({ kind: z.literal("orientation") }),
  glossarySchema.extend({ kind: z.literal("glossary") }),
]);
export type TourIntroduction = z.infer<typeof introductionSchema>;
export type IntroductionStep = z.infer<typeof introductionStepSchema>;
export const stepSchema = z
  .object({
    id: z.string().min(1).max(150),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().min(1).max(200),
    detail: text,
    explanation: z.string().max(6000).optional(),
    happyPath: z.array(sourceRefSchema).max(80).optional(),
    introduction: introductionStepSchema.optional(),
    kind: z.enum([
      "call",
      "return",
      "condition",
      "state",
      "async",
      "database",
      "retry",
      "concurrent",
    ]),
    guard: z.string().max(500).optional(),
    correspondence: z.string().max(150).optional(),
    symbolId: z.string().optional(),
    evidence: z.array(sourceRefSchema).min(1).max(20),
    provenance: z.enum(["extracted", "resolved", "inferred"]),
  })
  .strict();
export const taskContextSchema = z
  .object({
    goal: z.string().trim().min(1).max(1500),
    changes: z.array(z.string().trim().min(1).max(600)).max(15).default([]),
    additions: z.array(z.string().trim().min(1).max(600)).max(15).default([]),
    approach: z.array(z.string().trim().min(1).max(600)).max(15).default([]),
  })
  .strict();
export const scenarioSchema = z
  .object({
    id: z.string().min(1).max(150),
    storyId: z.string().min(1),
    title: z.string().min(1).max(200),
    summary: text,
    taskContext: taskContextSchema.optional(),
    participants: z
      .array(
        z
          .object({ id: z.string().min(1), label: z.string().min(1).max(100) })
          .strict(),
      )
      .min(1)
      .max(20),
    before: z.array(stepSchema).max(100),
    after: z.array(stepSchema).max(100),
    questions: z.array(text).max(30),
    provenance: z.literal("inferred"),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioStep = z.infer<typeof stepSchema>;
export const publicationSchema = z
  .object({
    expectedGeneration: z.number().int().nonnegative(),
    stories: z.array(storySchema).max(100).optional(),
    scenarios: z.array(scenarioSchema).max(100).optional(),
  })
  .strict();
export interface Coverage {
  files: number;
  parsed: number;
  cached: number;
  symbols: number;
  unresolved: number;
  gaps: { path: string; reason: string }[];
  milliseconds: number;
}
export interface ExecutionEvidence {
  id: string;
  label: string;
  kind: "reported-result" | "execution-artifact";
  revision: string;
  artifactHash?: string;
  artifactName?: string;
  description: string;
  createdAt: string;
}
export interface ReviewBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  analyzerVersion: string;
  id: string;
  generation: number;
  createdAt: string;
  comparison: Comparison;
  title: string;
  files: FileChange[];
  symbols: CodeSymbol[];
  relationships: Relationship[];
  stories: ChangeStory[];
  scenarios: Scenario[];
  coverage: Coverage;
  executionEvidence: ExecutionEvidence[];
  contextSnapshots: string[];
  prContextSnapshot?: string;
  previousReviewId?: string;
}
export const selectionSchema = z
  .object({
    view: z.enum(["overview", "structure", "flow", "landscape"]),
    storyId: z.string().optional(),
    symbolId: z.string().optional(),
    scenarioId: z.string().optional(),
    stepId: z.string().optional(),
    side: z.enum(["before", "after"]).optional(),
    filePath: z.string().optional(),
    contextEntryId: z.string().max(150).optional(),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;
export type ReviewOverview = Omit<ReviewBundle, "symbols" | "relationships">;
export interface GraphSlice {
  symbols: CodeSymbol[];
  relationships: Relationship[];
  total: number;
  truncated: boolean;
  unresolved: number;
}
export interface ModuleHeat {
  id: string;
  label: string;
  files: string[];
  symbols: number;
  changed: number;
  churn: number;
  unresolved: number;
}
export const memorySchema = z
  .object({
    state: z.enum(["unread", "understood", "question"]),
    note: z.string().max(10000),
    bookmarked: z.boolean(),
  })
  .strict();
export type ReviewMemory = z.infer<typeof memorySchema> & {
  fingerprint: string;
  stale: boolean;
  updatedAt: string;
};
export const openReviewSchema = z
  .object({
    repository: z.string().min(1),
    base: z.string().default("HEAD~1"),
    head: z.string().default("HEAD"),
    workingTree: z.boolean().default(false),
    pullRequest: z.string().optional(),
    title: z.string().max(200).optional(),
  })
  .strict();
export type OpenReviewInput = z.infer<typeof openReviewSchema>;
export interface AnalysisJob {
  id: string;
  state: "running" | "complete" | "failed" | "cancelled";
  phase: string;
  completed: number;
  total: number;
  reviewId?: string;
  snapshotId?: string;
  repositoryId?: string;
  error?: string;
  createdAt: string;
}
export function symbolVersion(s: CodeSymbol, side: Side = "after") {
  return s[side] ?? s.before ?? s.after!;
}
export function changed(s: CodeSymbol) {
  return !s.changes.includes("unchanged");
}
export function moduleFor(file: string) {
  const parts = file.split("/");
  const flow = parts.indexOf("flow");
  if (flow >= 0 && parts[flow + 1]) return `${parts[0]} / ${parts[flow + 1]}`;
  const src = parts.indexOf("src");
  if (src >= 0)
    return `${parts[0] === "pro" ? "frontend" : parts[0]} / ${parts[src + 2] && parts.length > src + 3 ? parts[src + 2] : (parts[src + 1] ?? "app")}`;
  return parts.length > 2
    ? `${parts[0]} / ${parts[1]}`
    : parts[0].includes(".")
      ? "Project"
      : parts[0];
}
export function categoryFor(path: string): Category {
  if (
    /(^|\/)(__tests__|tests?|specs?|fixtures|baselines)(\/|\.)|\.(test|spec)\.|Tests?\.(swift|py)$|(^|\/)test_/.test(
      path,
    ) ||
    /Tests\//.test(path)
  )
    return "test";
  if (/\.(md|rst|txt)$/.test(path)) return "documentation";
  if (
    /(^|\/)(deploy|\.github|conf|config)(\/|\.)|\.(ya?ml|toml|json|service|sh)$|(^|\/)(Dockerfile|Containerfile|Package\.swift)/.test(
      path,
    )
  )
    return "configuration";
  if (/\.(svg|png|jpg|jpeg|gz|woff2?|ttf|pdf)$/.test(path)) return "asset";
  return "production";
}
