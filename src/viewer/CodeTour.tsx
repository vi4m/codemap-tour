import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileCode2,
  GitCompareArrows,
  List,
  MessageSquareText,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  Relationship,
  ReviewOverview,
  Scenario,
  ScenarioStep,
  Selection,
  Side,
  SourceRef,
} from "../shared/model";
import type { LineComment, TourLineSelection } from "../shared/code-comments";
import { api } from "./api";
import { TourIntroduction, type IntroductionPreview } from "./TourIntroduction";
import { GuideNote } from "./GuideNote";
import { CodeReader } from "./CodeReader";
import { highlight } from "./SourceCode";
import "./code-tour.css";

interface Chapter {
  key: string;
  before?: ScenarioStep;
  after?: ScenarioStep;
}
interface SourcePage {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}
interface Patch {
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
  truncated: boolean;
}
const NO_LINKS: Relationship[] = [];
const NO_COMMENTS: LineComment[] = [];
const AUTO_DELAY = 12000;
const QUESTION_TEMPLATES = [
  "Explain me this more",
  "explain me step by step how it works",
  "Is that really needed?",
];

// Keep the before/after correspondence, including steps that exist on only one side.
function chaptersFor(scenario: Scenario): Chapter[] {
  const key = (step: ScenarioStep) => step.correspondence ?? step.id;
  const chapters: Chapter[] = scenario.before.map((step) => ({
    key: key(step),
    before: step,
  }));
  scenario.after.forEach((step, i) => {
    const existing = chapters.find((chapter) => chapter.key === key(step));
    if (existing) {
      existing.after = step;
      return;
    }
    const nextKey = scenario.after
      .slice(i + 1)
      .map(key)
      .find((candidate) => chapters.some((c) => c.key === candidate));
    const index = nextKey
      ? chapters.findIndex((chapter) => chapter.key === nextKey)
      : -1;
    const chapter = { key: key(step), after: step };
    if (index < 0) chapters.push(chapter);
    else chapters.splice(index, 0, chapter);
  });
  return chapters;
}

export function CodeTour({
  review,
  scenario,
  selection,
  onSelect,
  onClose,
  request = api,
  onAskCodex,
  embedded = false,
  chapterOrder,
  diffRequiresBoth = false,
  lineComments = NO_COMMENTS,
  onDiscussLine,
  onLineFocus,
  onSourceFocus,
}: {
  review: Pick<ReviewOverview, "id" | "files">;
  scenario: Scenario;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
  request?: typeof api;
  onAskCodex?: (selection: Selection) => void;
  embedded?: boolean;
  chapterOrder?: string[];
  diffRequiresBoth?: boolean;
  lineComments?: LineComment[];
  onDiscussLine?: (selected: TourLineSelection, question: string) => void;
  onLineFocus?: (selected: TourLineSelection | null) => void;
  onSourceFocus?: (source: {
    ref: SourceRef;
    stepId: string;
    side: Side;
    overview?: boolean;
  }) => void;
}) {
  const chapters = useMemo(() => {
    const result = chaptersFor(scenario);
    if (!chapterOrder) return result;
    const order = new Map(chapterOrder.map((key, index) => [key, index]));
    return result.sort(
      (a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity),
    );
  }, [scenario, chapterOrder]);
  const found = chapters.findIndex(
    (chapter) => chapter[selection.side ?? "after"]?.id === selection.stepId,
  );
  const index = Math.max(0, found);
  const chapter = chapters[index];
  const [mode, setMode] = useState<Side | "diff">(
    selection.side ?? (chapter?.after ? "after" : "before"),
  );
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [introductionPreview, setIntroductionPreview] = useState<
    (IntroductionPreview & { stepId: string }) | null
  >(null);
  const [pageStart, setPageStart] = useState<number>();
  const [source, setSource] = useState<SourcePage & { key: string }>();
  const [patch, setPatch] = useState<Patch & { key: string }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [noteOpen, setNoteOpen] = useState(true);
  const [contextPinned, setContextPinned] = useState(false);
  const [contextHover, setContextHover] = useState(false);
  const [focusMode, setFocusMode] = useState<"off" | "dim" | "blur" | "hide">(
    "off",
  );
  const [focusStyle, setFocusStyle] = useState<"dim" | "blur" | "hide">("dim");
  const [focusOptions, setFocusOptions] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedLines, setSelectedLines] = useState<TourLineSelection | null>(
    null,
  );
  const [questionTemplate, setQuestionTemplate] = useState(
    QUESTION_TEMPLATES[0],
  );
  const [lineQuestion, setLineQuestion] = useState(QUESTION_TEMPLATES[0]);
  const onSelectRef = useRef(onSelect);
  const requestedSelection = useRef<string | undefined>(undefined);
  const diffRef = useRef<HTMLDivElement>(null);
  onSelectRef.current = onSelect;
  const selectedSide: Side =
    mode === "diff"
      ? (selection.side ?? (chapter?.after ? "after" : "before"))
      : mode;
  const step = chapter?.[selectedSide] ?? chapter?.after ?? chapter?.before;
  const refs = step?.evidence ?? [];
  const preview =
    introductionPreview?.stepId === step?.id ? introductionPreview : null;
  const showIntroduction = !!step?.introduction && !preview;
  const ref = preview?.ref ?? refs[Math.min(referenceIndex, refs.length - 1)];
  const refKey = ref ? JSON.stringify(ref) : "";
  const essentialRanges = useMemo(
    () =>
      (step?.happyPath ?? []).filter(
        (range) =>
          range.path === ref?.path &&
          range.revision === ref?.revision &&
          range.blob === ref?.blob,
      ),
    [step?.happyPath, ref?.path, ref?.revision, ref?.blob],
  );
  const hasHappyPath = essentialRanges.length > 0;
  useEffect(() => {
    if (ref && step)
      onSourceFocus?.({
        ref,
        stepId: step.id,
        side: selectedSide,
        overview: showIntroduction,
      });
  }, [refKey, step?.id, selectedSide, showIntroduction, onSourceFocus]);

  const comments = useMemo(
    () =>
      lineComments
        .filter(
          (note) =>
            note.stepId === step?.id &&
            note.ref.path === ref?.path &&
            note.ref.revision === ref?.revision &&
            note.ref.blob === ref?.blob,
        )
        .map((note) => ({
          id: note.id,
          text: note.text,
          startLine: note.ref.startLine,
          endLine: note.ref.endLine,
        })),
    [lineComments, step?.id, ref?.path, ref?.revision, ref?.blob],
  );
  useEffect(() => {
    setSelectedLines(null);
    setLineQuestion(questionTemplate);
  }, [refKey, step?.id, mode, pageStart, showIntroduction]);
  useEffect(() => {
    const timer = window.setTimeout(() => onLineFocus?.(selectedLines), 150);
    return () => window.clearTimeout(timer);
  }, [selectedLines, onLineFocus]);
  const file =
    ref &&
    (review.files.find((candidate) =>
      [candidate.before, candidate.after].some(
        (source) =>
          source?.path === ref.path &&
          source.revision === ref.revision &&
          source.blob === ref.blob,
      ),
    ) ??
      review.files.find((candidate) =>
        [
          candidate.path,
          candidate.previousPath,
          candidate.before?.path,
          candidate.after?.path,
        ].includes(ref.path),
      ));
  const fileBefore = file?.before;
  const fileAfter = file?.after;
  const canDiff = diffRequiresBoth
    ? !!fileBefore && !!fileAfter
    : !!fileBefore || !!fileAfter;
  const patchKey = JSON.stringify([review.id, fileBefore, fileAfter]);

  const selectChapter = useCallback(
    (at: number, stop = true) => {
      const target = chapters[at];
      if (!target) return;
      if (stop) setPlaying(false);
      const side: Side = target.after ? "after" : "before";
      const next = target[side]!;
      requestedSelection.current = `${side}:${next.id}`;
      onSelectRef.current({
        view: "flow",
        storyId: scenario.storyId,
        scenarioId: scenario.id,
        stepId: next.id,
        side,
        symbolId: next.symbolId,
      });
      setMode(side);
      setChaptersOpen(false);
    },
    [chapters, scenario.id, scenario.storyId],
  );

  useEffect(() => {
    const key = `${selection.side ?? "after"}:${selection.stepId ?? ""}`;
    if (requestedSelection.current !== key) setPlaying(false);
    requestedSelection.current = undefined;
    setReferenceIndex(0);
    setPageStart(undefined);
    setMode(selection.side ?? (chapter?.after ? "after" : "before"));
  }, [chapter?.key, selection.side, selection.stepId]);
  useEffect(() => {
    setPageStart(undefined);
  }, [refKey]);

  useEffect(() => {
    if (showIntroduction) {
      setSource(undefined);
      setError("");
      setLoading(false);
      return;
    }
    if (!ref || mode === "diff") return;
    const controller = new AbortController();
    setSource(undefined);
    setError("");
    setLoading(true);
    const pageRef =
      pageStart === undefined
        ? ref
        : {
            ...ref,
            startLine: pageStart,
            endLine: Math.min(
              source?.totalLines ?? pageStart + 79,
              pageStart + 79,
            ),
          };
    request<SourcePage>(`/reviews/${review.id}/source`, {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        ref: pageRef,
        context: pageStart === undefined ? 30 : 0,
        limit: 300,
      }),
    })
      .then((value) => {
        if (!controller.signal.aborted) setSource({ ...value, key: refKey });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load source.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // refKey contains every field of the immutable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    review.id,
    refKey,
    pageStart,
    mode === "diff",
    showIntroduction,
    request,
  ]);

  useEffect(() => {
    if (showIntroduction || mode !== "diff" || (!fileBefore && !fileAfter))
      return;
    const controller = new AbortController();
    setPatch(undefined);
    setError("");
    setLoading(true);
    request<Patch>(`/reviews/${review.id}/diff`, {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({ before: fileBefore, after: fileAfter }),
    })
      .then((value) => {
        if (!controller.signal.aborted) setPatch({ ...value, key: patchKey });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load diff.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // patchKey identifies the captured files on both sides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode === "diff", patchKey, showIntroduction, request]);

  useEffect(() => {
    if (
      mode !== "diff" ||
      loading ||
      !patch ||
      patch.key !== patchKey ||
      !ref ||
      !diffRef.current
    )
      return;
    const sections = [
      ...diffRef.current.querySelectorAll<HTMLElement>("[data-diff-start]"),
    ];
    const nearest = sections.reduce<HTMLElement | undefined>(
      (best, section) => {
        const distance = Math.abs(
          Number(section.dataset.diffStart) - ref.startLine,
        );
        const bestDistance = best
          ? Math.abs(Number(best.dataset.diffStart) - ref.startLine)
          : Infinity;
        return distance < bestDistance ? section : best;
      },
      undefined,
    );
    nearest?.scrollIntoView({ block: "start" });
  }, [mode, loading, patch, patchKey, refKey]);

  useEffect(() => {
    if (!playing || loading || error) return;
    const timer = window.setTimeout(() => {
      if (index + 1 >= chapters.length) setPlaying(false);
      else selectChapter(index + 1, false);
    }, AUTO_DELAY);
    return () => window.clearTimeout(timer);
  }, [playing, loading, error, index, chapters.length, selectChapter]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], .tour-task-context, .tour-focus-options',
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (preview) setIntroductionPreview(null);
        else onClose();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectChapter(index - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        selectChapter(index + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, onClose, selectChapter, preview]);

  function chooseSide(side: Side) {
    const target = chapter?.[side];
    if (!target) return;
    setPlaying(false);
    setMode(side);
    requestedSelection.current = `${side}:${target.id}`;
    onSelectRef.current({
      view: "flow",
      storyId: scenario.storyId,
      scenarioId: scenario.id,
      stepId: target.id,
      side,
      symbolId: target.symbolId,
    });
  }
  function toggleChapters() {
    setPlaying(false);
    setChaptersOpen((open) => !open);
    setHelpOpen(false);
  }
  function togglePlay() {
    if (!playing && index === chapters.length - 1 && chapters.length > 1)
      selectChapter(0, false);
    setPlaying(!playing);
  }
  if (!chapter || !step) return null;

  return (
    <div className="code-tour" role="region" aria-label="Code tour">
      <header className="tour-header">
        {!embedded && (
          <>
            <button
              className="tour-close"
              onClick={onClose}
              aria-label="Close code tour"
            >
              <ChevronLeft size={17} />
              <span>Review</span>
            </button>
            <span className="tour-header-divider" />
          </>
        )}
        <div
          className="tour-title-context"
          onPointerEnter={() => setContextHover(true)}
          onPointerLeave={() => setContextHover(false)}
        >
          <button
            className="tour-name"
            aria-label="Task context"
            aria-expanded={contextPinned || contextHover}
            onClick={() => {
              setContextPinned(!contextPinned);
              setPlaying(false);
            }}
          >
            {scenario.title}
            <ChevronDown size={13} />
          </button>
          {(contextPinned || contextHover) && (
            <aside
              className="tour-task-context"
              aria-label="Overall task context"
            >
              <div>
                <strong>Task context</strong>
                <button
                  aria-label="Close task context"
                  onClick={() => {
                    setContextPinned(false);
                    setContextHover(false);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              {scenario.taskContext ? (
                <>
                  <h3>Goal</h3>
                  <p>{scenario.taskContext.goal}</p>
                  {(
                    [
                      ["Changes", scenario.taskContext.changes],
                      ["Added", scenario.taskContext.additions],
                      ["How to reach the goal", scenario.taskContext.approach],
                    ] as const
                  ).map(
                    ([label, items]) =>
                      items.length > 0 && (
                        <section key={label}>
                          <h3>{label}</h3>
                          <ul>
                            {items.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      ),
                  )}
                </>
              ) : (
                <p>
                  {scenario.summary ||
                    "Task context has not been added to this tour yet."}
                </p>
              )}
            </aside>
          )}
        </div>
        <span className="tour-header-spacer" />
        <div className="tour-happy-path">
          <button
            className={`tour-top-action ${focusMode !== "off" && hasHappyPath ? "active" : ""}`}
            aria-label="Happy Path"
            aria-pressed={focusMode !== "off" && hasHappyPath}
            title={
              hasHappyPath
                ? "Show only the essential fragments of the normal execution path"
                : "No Happy Path fragments have been marked for this file"
            }
            onClick={() => {
              setFocusMode(focusMode === "off" ? focusStyle : "off");
              setFocusOptions(false);
              setPlaying(false);
            }}
            disabled={showIntroduction || mode === "diff" || !hasHappyPath}
          >
            Happy Path
          </button>
          <button
            aria-label="Happy Path visual options"
            aria-expanded={focusOptions}
            onClick={() => setFocusOptions(!focusOptions)}
          >
            <ChevronDown size={13} />
          </button>
          {focusOptions && (
            <div
              className="tour-focus-options"
              role="menu"
              aria-label="Happy Path visual styles"
            >
              <small>
                {hasHappyPath
                  ? "Other lines in this path"
                  : "No essential fragments marked"}
              </small>
              {(["dim", "blur", "hide"] as const).map((style) => (
                <button
                  key={style}
                  role="menuitemradio"
                  aria-checked={focusMode === style && hasHappyPath}
                  disabled={!hasHappyPath || mode === "diff"}
                  onClick={() => {
                    setFocusStyle(style);
                    setFocusMode(style);
                    setFocusOptions(false);
                    setPlaying(false);
                  }}
                >
                  {{ dim: "Dim", blur: "Blur", hide: "Hide with gaps" }[style]}
                </button>
              ))}
              <button
                role="menuitemradio"
                aria-checked={focusMode === "off"}
                onClick={() => {
                  setFocusMode("off");
                  setFocusOptions(false);
                }}
              >
                Show all lines
              </button>
            </div>
          )}
        </div>
        <button
          className={`tour-top-action ${mode === "diff" ? "active" : ""}`}
          onClick={() => {
            setPlaying(false);
            setMode(mode === "diff" ? selectedSide : "diff");
          }}
          disabled={!!step.introduction || !canDiff}
          aria-label="Diff"
          title="Show code diff"
          aria-pressed={mode === "diff"}
        >
          <GitCompareArrows size={15} />
          <span>Diff</span>
        </button>
        <button
          className={`tour-top-action ${noteOpen ? "active" : ""}`}
          onClick={() => setNoteOpen(!noteOpen)}
          aria-label={noteOpen ? "Hide explanation" : "Show explanation"}
          aria-pressed={noteOpen}
          disabled={showIntroduction}
        >
          <MessageSquareText size={15} />
          <span>Note</span>
        </button>
        {!embedded && (
          <button
            className="tour-close-icon"
            onClick={onClose}
            aria-label="Close tour"
          >
            <X size={17} />
          </button>
        )}
      </header>
      <div className="tour-filebar">
        {step.introduction && (
          <button
            className="tour-back-introduction"
            disabled={showIntroduction}
            onClick={() => {
              setPlaying(false);
              setIntroductionPreview(null);
              setMode(selectedSide);
            }}
          >
            {preview && <ChevronLeft size={13} />} {step.introduction.title}
          </button>
        )}
        {!showIntroduction && (
          <>
            <div className="tour-file-name">
              <FileCode2 size={15} />
              <nav
                className="tour-breadcrumbs"
                aria-label="Source directory"
                title={ref?.path}
              >
                {ref
                  ? ref.path.split("/").map((part, i, parts) => (
                      <span
                        key={i}
                        title={parts.slice(0, i + 1).join("/")}
                        className={i === parts.length - 1 ? "current" : ""}
                      >
                        {i > 0 && <b>/</b>}
                        {part}
                      </span>
                    ))
                  : "Source unavailable"}
              </nav>
              <span>
                {ref &&
                  `L${ref.startLine}${ref.endLine !== ref.startLine ? `–${ref.endLine}` : ""}`}
              </span>
            </div>
            <span
              className="tour-comment-count"
              aria-label="Line comments"
              title="Comments for this step and source version"
            >
              {comments.length
                ? `${comments.length} ${comments.length === 1 ? "comment · hover dot" : "comments · hover dots"}`
                : "No line comments"}
            </span>
            <div className="tour-revision" title={ref?.revision}>
              {ref?.revision.startsWith("worktree:")
                ? "snapshot"
                : ref?.revision.slice(0, 8)}{" "}
              <span>·</span> read only
            </div>
            {!step.introduction && (
              <div className="tour-side-switch" aria-label="Source version">
                <button
                  onClick={() => chooseSide("before")}
                  disabled={!chapter.before}
                  className={mode === "before" ? "active" : ""}
                  aria-pressed={mode === "before"}
                >
                  Before
                </button>
                <button
                  onClick={() => chooseSide("after")}
                  disabled={!chapter.after}
                  className={mode === "after" ? "active" : ""}
                  aria-pressed={mode === "after"}
                >
                  After
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {!step.introduction && refs.length > 1 && (
        <nav className="tour-chapter-files" aria-label="Files in this chapter">
          <span>{refs.length} fragments · one chapter</span>
          {refs.map((item, i) => (
            <button
              key={`${item.path}:${item.startLine}:${i}`}
              title={item.path}
              aria-pressed={referenceIndex === i}
              onClick={() => {
                setPlaying(false);
                setReferenceIndex(i);
              }}
            >
              {item.path.split("/").at(-1)}{" "}
              <small>
                L{item.startLine}–{item.endLine}
              </small>
            </button>
          ))}
        </nav>
      )}
      <main className="tour-stage">
        {step.introduction && (
          <TourIntroduction
            key={step.id}
            content={step.introduction}
            onInteract={() => setPlaying(false)}
            hidden={!showIntroduction}
            onPreview={(source) => {
              setPlaying(false);
              setIntroductionPreview({ ...source, stepId: step.id });
              setMode(selectedSide);
            }}
          />
        )}
        {!showIntroduction && loading && (
          <div className="tour-stage-message" role="status">
            Loading captured code…
          </div>
        )}
        {!showIntroduction && error && (
          <div className="tour-stage-message tour-error" role="alert">
            {error}
          </div>
        )}
        {!showIntroduction &&
          !loading &&
          !error &&
          mode !== "diff" &&
          source?.key === refKey &&
          ref && (
            <div
              className="tour-editor"
              onWheel={() => setPlaying(false)}
              onTouchStart={() => setPlaying(false)}
            >
              <CodeReader
                path={ref.path}
                content={source.content}
                line={
                  ref.endLine >= source.startLine &&
                  ref.startLine <= source.endLine
                    ? Math.max(source.startLine, ref.startLine)
                    : undefined
                }
                endLine={Math.min(source.endLine, ref.endLine)}
                firstLine={source.startLine}
                tour
                focusMode={hasHappyPath ? focusMode : "off"}
                essentialRanges={essentialRanges}
                onShowAll={() => setFocusMode("off")}
                links={NO_LINKS}
                onReference={() => {}}
                onLine={() => setPlaying(false)}
                comments={comments}
                onCodeSelection={
                  onDiscussLine
                    ? (selected) => {
                        setPlaying(false);
                        setLineQuestion(questionTemplate);
                        setSelectedLines({
                          ref: {
                            ...ref,
                            startLine: selected.startLine,
                            endLine: selected.endLine,
                          },
                          code: selected.code,
                          stepId: step.id,
                          side: selectedSide,
                        });
                      }
                    : undefined
                }
              />
            </div>
          )}
        {!showIntroduction &&
          !loading &&
          !error &&
          mode === "diff" &&
          patch?.key === patchKey && (
            <div
              ref={diffRef}
              className="tour-diff"
              tabIndex={0}
              aria-label="Code diff"
            >
              {!patch.hunks.length && <p>No textual changes for this file.</p>}
              {patch.hunks.map((hunk, h) => {
                let before = hunk.oldStart,
                  after = hunk.newStart;
                return (
                  <section
                    key={h}
                    data-diff-start={
                      selectedSide === "before" ? hunk.oldStart : hunk.newStart
                    }
                  >
                    <div className="tour-diff-hunk">
                      @@ {hunk.oldStart} → {hunk.newStart} @@
                    </div>
                    {hunk.lines.map((line, i) => {
                      const marker = line[0];
                      const oldNumber =
                        marker === "+" || marker === "\\" ? "" : before++;
                      const newNumber =
                        marker === "-" || marker === "\\" ? "" : after++;
                      return (
                        <div
                          className={`tour-diff-line ${marker === "+" ? "added" : marker === "-" ? "removed" : ""}`}
                          key={i}
                        >
                          <span>{oldNumber}</span>
                          <span>{newNumber}</span>
                          <b>{marker}</b>
                          <code>{highlight(line.slice(1))}</code>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              {patch.truncated && <p>Diff limited to 800 lines.</p>}
            </div>
          )}
        {!showIntroduction && !loading && !error && !ref && (
          <div className="tour-stage-message">
            No source is available for this step.
          </div>
        )}
        {selectedLines && onDiscussLine && (
          <aside
            className="tour-line-discussion"
            aria-label="Discuss selected code"
          >
            <div>
              <strong>
                Selected · L{selectedLines.ref.startLine}
                {selectedLines.ref.endLine !== selectedLines.ref.startLine
                  ? `–${selectedLines.ref.endLine}`
                  : ""}
              </strong>
              <button
                aria-label="Close line discussion"
                onClick={() => setSelectedLines(null)}
              >
                <X size={14} />
              </button>
            </div>
            <select
              aria-label="Question template"
              value={questionTemplate}
              onChange={(event) => {
                setQuestionTemplate(event.target.value);
                setLineQuestion(event.target.value);
              }}
            >
              {QUESTION_TEMPLATES.map((template) => (
                <option key={template} value={template}>
                  {template}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Question about selected lines"
              placeholder="What would you like to understand?"
              value={lineQuestion}
              onChange={(event) => setLineQuestion(event.target.value)}
              rows={2}
              maxLength={2000}
            />
            <button
              className="tour-discuss-action"
              onClick={() => onDiscussLine(selectedLines, lineQuestion)}
            >
              <MessageSquareText size={15} /> Discuss in Codex
            </button>
          </aside>
        )}
        {!showIntroduction && noteOpen && (
          <GuideNote
            step={
              preview
                ? {
                    ...step,
                    label: preview.label,
                    detail: preview.detail,
                    explanation: preview.explanation,
                  }
                : step
            }
            refs={preview ? [preview.ref] : refs}
            referenceIndex={preview ? 0 : referenceIndex}
            onReference={(i) => {
              setPlaying(false);
              setReferenceIndex(i);
            }}
            onClose={() => setNoteOpen(false)}
            onInteract={() => setPlaying(false)}
          />
        )}
        {!showIntroduction && !noteOpen && (
          <button className="tour-show-note" onClick={() => setNoteOpen(true)}>
            <MessageSquareText size={14} /> Show note
          </button>
        )}
        {!showIntroduction && mode !== "diff" && source?.key === refKey && (
          <div className="tour-page-actions">
            <button
              disabled={source.startLine <= 1}
              onClick={() => {
                setPlaying(false);
                setPageStart(Math.max(1, source.startLine - 80));
              }}
            >
              <ChevronLeft size={13} /> Earlier
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setPageStart(undefined);
              }}
              disabled={pageStart === undefined}
            >
              <RotateCcw size={12} /> Focus
            </button>
            <button
              disabled={source.endLine >= source.totalLines}
              onClick={() => {
                setPlaying(false);
                setPageStart(source.endLine + 1);
              }}
            >
              Later <ChevronRight size={13} />
            </button>
          </div>
        )}
      </main>
      <footer className="tour-player">
        {chaptersOpen && (
          <div
            id="tour-chapter-menu"
            className="tour-chapters"
            role="menu"
            aria-label="Tour chapters"
          >
            <div>
              CHAPTERS <span>{chapters.length} stops</span>
            </div>
            {chapters.map((item, i) => (
              <button
                role="menuitem"
                key={item.key}
                className={i === index ? "active" : ""}
                onClick={() => selectChapter(i)}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{(item.after ?? item.before)?.label}</strong>
                {i === index && <span>NOW</span>}
              </button>
            ))}
          </div>
        )}
        {helpOpen && (
          <div className="tour-help">
            <strong>Continue with Codex</strong>
            <p>
              Ask Codex about the selected step in your chat or Voice session.
              Auto advance changes code every 12 seconds; it does not control
              Voice.
            </p>
            <button onClick={() => setHelpOpen(false)}>Got it</button>
          </div>
        )}
        <div className="tour-progress" aria-label="Tour progress">
          {chapters.map((item, i) => (
            <button
              key={item.key}
              className={`${i < index ? "done" : ""} ${i === index ? "current" : ""}`}
              onClick={() => selectChapter(i)}
              aria-label={`Chapter ${i + 1}: ${(item.after ?? item.before)?.label}`}
              aria-current={i === index ? "step" : undefined}
              title={(item.after ?? item.before)?.label}
            >
              <span />
            </button>
          ))}
        </div>
        <div className="tour-controls">
          <button
            className="tour-control-icon"
            onClick={() => selectChapter(index - 1)}
            disabled={index === 0}
            aria-label="Previous step"
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="tour-play"
            onClick={togglePlay}
            disabled={chapters.length < 2}
            aria-label={playing ? "Pause auto advance" : "Play auto advance"}
            title="Automatically advance every 12 seconds. Voice is separate."
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            className="tour-control-icon"
            onClick={() => selectChapter(index + 1)}
            disabled={index >= chapters.length - 1}
            aria-label="Next step"
          >
            <ChevronRight size={19} />
          </button>
          <span className="tour-count">
            {String(index + 1).padStart(2, "0")}{" "}
            <span>/ {String(chapters.length).padStart(2, "0")}</span>
          </span>
          <button
            className="tour-current-title"
            onClick={toggleChapters}
            aria-label={`Choose chapter: ${step.label}`}
            aria-haspopup="menu"
            aria-expanded={chaptersOpen}
            aria-controls="tour-chapter-menu"
            title={step.label}
          >
            <span>{step.label}</span>
            <ChevronDown size={13} />
          </button>
          <span className="tour-controls-spacer" />
          <span className="tour-auto-label">
            {playing ? "Auto · 12 s per step" : "Manual"}
          </span>
          <button
            className="tour-footer-button"
            onClick={toggleChapters}
            aria-expanded={chaptersOpen}
            aria-label="Chapters"
            aria-haspopup="menu"
            aria-controls="tour-chapter-menu"
          >
            <List size={15} />
            <span>Chapters</span>
          </button>
          <button
            className="tour-footer-button"
            onClick={() => {
              setPlaying(false);
              if (onAskCodex) onAskCodex(selection);
              else setHelpOpen(!helpOpen);
              setChaptersOpen(false);
            }}
            aria-label="Ask Codex about this step"
            aria-expanded={helpOpen}
          >
            <CircleHelp size={15} />
            <span>Ask Codex</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
