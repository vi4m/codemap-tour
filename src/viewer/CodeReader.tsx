import { useEffect, useRef } from "react";
import {
  EditorState,
  Compartment,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
  keymap,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
  WidgetType,
  hoverTooltip,
} from "@codemirror/view";
import {
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { defaultKeymap } from "@codemirror/commands";
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import type { CodeSelection } from "../shared/code-comments";
import type { Relationship } from "../shared/model";

const sourceHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#8e4c91" },
  { tag: [tags.variableName, tags.name], color: "#374553" },
  {
    tag: [tags.function(tags.variableName), tags.propertyName],
    color: "#406b90",
  },
  { tag: [tags.typeName, tags.className], color: "#48776e" },
  { tag: [tags.string, tags.regexp], color: "#8b6635" },
  { tag: [tags.number, tags.bool, tags.null], color: "#a25b67" },
  { tag: tags.comment, color: "#89919a", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#7a7c91" },
]);
const tourHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: [tags.variableName, tags.name], color: "#d8dfeb" },
  {
    tag: [tags.function(tags.variableName), tags.propertyName],
    color: "#82aaff",
  },
  { tag: [tags.typeName, tags.className], color: "#ffcb8b" },
  { tag: [tags.string, tags.regexp], color: "#c3e88d" },
  { tag: [tags.number, tags.bool, tags.null], color: "#f78c6c" },
  { tag: tags.comment, color: "#8993a6", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#b5c1d4" },
]);

const refreshHappyPath = StateEffect.define<null>();
const selectedRange = StateEffect.define<{ line: number; endLine?: number }>();
const rangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects)
      if (e.is(selectedRange)) {
        const start = tr.state.doc.line(
          Math.min(e.value.line, tr.state.doc.lines),
        );
        const end = tr.state.doc.line(
          Math.min(e.value.endLine ?? e.value.line, tr.state.doc.lines),
        );
        const marks = [
          Decoration.line({ class: "cm-source-line" }).range(start.from),
        ];
        if (end.to > start.from)
          marks.push(
            Decoration.mark({ class: "cm-source-range" }).range(
              start.from,
              end.to,
            ),
          );
        return Decoration.set(marks, true);
      }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
const tourRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(selectedRange)) continue;
      const first = Math.max(1, Math.min(e.value.line, tr.state.doc.lines));
      const last = Math.max(
        first,
        Math.min(e.value.endLine ?? first, tr.state.doc.lines),
      );
      const marks = [];
      for (let line = first; line <= last; line++) {
        const edges = `${line === first ? " cm-tour-first" : ""}${line === last ? " cm-tour-last" : ""}`;
        marks.push(
          Decoration.line({ class: `cm-tour-focus${edges}` }).range(
            tr.state.doc.line(line).from,
          ),
        );
      }
      return Decoration.set(marks, true);
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "#fff",
    color: "#393443",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.85",
    overflow: "auto",
  },
  ".cm-content": { padding: "18px 0", minWidth: "100%" },
  ".cm-line": { padding: "0 22px 0 14px" },
  ".cm-gutters": {
    backgroundColor: "#faf9fc",
    color: "#a69eaf",
    borderRight: "1px solid #f0edf4",
    padding: "0 8px",
  },
  ".cm-activeLineGutter": { backgroundColor: "#eee8f6" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "#e8def7",
  },
  ".cm-source-line": { backgroundColor: "#f3edf9" },
  ".cm-source-range": { backgroundColor: "#f3edf980" },
  ".cm-reference": {
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "4px",
    cursor: "pointer",
  },
  ".cm-panels": { backgroundColor: "#f7f4fb", color: "#554569" },
  "&.cm-focused": { outline: "none" },
});
const tourTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "15px",
      backgroundColor: "#151b26",
      color: "#d8dfeb",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: "1.85",
      overflow: "auto",
    },
    ".cm-content": { padding: "38px 0 100px", minWidth: "100%" },
    ".cm-content::selection, .cm-content ::selection": {
      backgroundColor: "#38536f",
      color: "inherit",
    },
    ".cm-line": { padding: "0 38px 0 22px" },
    ".cm-gutters": {
      backgroundColor: "#151b26",
      color: "#637084",
      border: "0",
      padding: "0 12px 0 22px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#9caabd",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#36516f",
    },
    ".cm-tour-focus": {
      backgroundColor: "#f0a04419",
      borderLeft: "3px solid #f2a440",
    },
    ".cm-tour-first": { boxShadow: "inset 0 1px #f2a44080" },
    ".cm-tour-last": { boxShadow: "inset 0 -1px #f2a44080" },
    ".cm-panels": { backgroundColor: "#222b3b", color: "#e3e8f1" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);
type ReaderComment = {
  id: string;
  startLine: number;
  endLine: number;
  text: string;
};
const NO_COMMENTS: ReaderComment[] = [];
const NO_ESSENTIAL: { startLine: number; endLine: number }[] = [];

export function CodeReader({
  path,
  content,
  line,
  endLine,
  links,
  onReference,
  onLine,
  firstLine = 1,
  tour = false,
  comments = NO_COMMENTS,
  onCodeSelection,
  focusMode = "off",
  essentialRanges = NO_ESSENTIAL,
  onShowAll,
}: {
  path: string;
  content: string;
  line?: number;
  endLine?: number;
  links: Relationship[];
  onReference: (link: Relationship) => void;
  onLine: (line: number) => void;
  firstLine?: number;
  tour?: boolean;
  comments?: ReaderComment[];
  onCodeSelection?: (selection: CodeSelection) => void;
  focusMode?: "off" | "dim" | "blur" | "hide";
  essentialRanges?: { startLine: number; endLine: number }[];
  onShowAll?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null);
  const reference = useRef(onReference),
    selectLine = useRef(onLine);
  const codeSelection = useRef(onCodeSelection);
  codeSelection.current = onCodeSelection;
  const showAll = useRef(onShowAll);
  showAll.current = onShowAll;
  reference.current = onReference;
  selectLine.current = onLine;
  useEffect(() => {
    if (!host.current) return;
    host.current.dataset.highlighted = "false";
    const language = new Compartment();
    const choose = (view: EditorView, from: number, to = from) => {
      const first = view.state.doc.lineAt(from);
      const last = view.state.doc.lineAt(
        to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to,
      );
      codeSelection.current?.({
        startLine: first.number + firstLine - 1,
        endLine: last.number + firstLine - 1,
        code: view.state.doc.sliceString(first.from, last.to),
      });
    };
    const notesAt = (line: number) =>
      comments.filter((note) => note.startLine <= line && note.endLine >= line);
    class CommentMarker extends GutterMarker {
      constructor(
        readonly notes: ReaderComment[],
        readonly number: number,
      ) {
        super();
      }
      toDOM() {
        const button = document.createElement("button");
        button.className = "cm-line-comment-marker";
        button.textContent = "•";
        button.setAttribute("aria-label", `Comment on line ${this.number}`);
        button.title = this.notes.map((note) => note.text).join("\n\n");
        button.onclick = () => {
          const view = editor.current;
          if (view)
            choose(view, view.state.doc.line(this.number - firstLine + 1).from);
        };
        return button;
      }
    }

    class HiddenLines extends WidgetType {
      constructor(readonly count: number) {
        super();
      }
      toDOM() {
        const dom = document.createElement("div");
        dom.className = "cm-happy-gap";
        const button = document.createElement("button");
        button.textContent = `${this.count} ${this.count === 1 ? "line" : "lines"} hidden · Show all`;
        button.onclick = () => showAll.current?.();
        dom.append(button);
        return dom;
      }
      ignoreEvent() {
        return true;
      }
    }
    const focusField = StateField.define<DecorationSet>({
      create: () => Decoration.none,
      update(value, tr) {
        if (
          !tr.effects.some(
            (effect) => effect.is(selectedRange) || effect.is(refreshHappyPath),
          ) ||
          focusMode === "off"
        )
          return value;
        if (!essentialRanges.length) return Decoration.none;
        const important = (number: number) =>
          essentialRanges.some(
            (range) =>
              number + firstLine - 1 >= range.startLine &&
              number + firstLine - 1 <= range.endLine,
          );
        const marks = [];
        for (let number = 1; number <= tr.state.doc.lines; number++) {
          if (important(number)) {
            marks.push(
              Decoration.line({ class: "cm-happy-key" }).range(
                tr.state.doc.line(number).from,
              ),
            );
            continue;
          }
          if (focusMode === "hide") {
            const from = number;
            while (number < tr.state.doc.lines && !important(number + 1))
              number++;
            marks.push(
              Decoration.replace({
                block: true,
                widget: new HiddenLines(number - from + 1),
              }).range(
                tr.state.doc.line(from).from,
                tr.state.doc.line(number).to,
              ),
            );
          } else
            marks.push(
              Decoration.line({ class: `cm-happy-${focusMode}` }).range(
                tr.state.doc.line(number).from,
              ),
            );
        }
        return Decoration.set(marks, true);
      },
      provide: (field) => EditorView.decorations.from(field),
    });
    const state = EditorState.create({
      doc: content,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: "0",
          "aria-label": `Source code: ${path}`,
        }),
        lineNumbers({
          formatNumber: (line) => String(line + firstLine - 1),
          domEventHandlers: {
            click: (view, block) => {
              selectLine.current(
                view.state.doc.lineAt(block.from).number + firstLine - 1,
              );
              if (codeSelection.current) choose(view, block.from);
              return true;
            },
          },
        }),
        ...(comments.length
          ? [
              gutter({
                class: "cm-comment-gutter",
                lineMarker: (view, block) => {
                  const number =
                    view.state.doc.lineAt(block.from).number + firstLine - 1;
                  const notes = notesAt(number);
                  return notes.length ? new CommentMarker(notes, number) : null;
                },
                domEventHandlers: {
                  click: (view, block) => {
                    choose(view, block.from);
                    return true;
                  },
                },
              }),
              hoverTooltip(
                (view, pos) => {
                  const line = view.state.doc.lineAt(pos);
                  const number = line.number + firstLine - 1;
                  const notes = notesAt(number);
                  if (!notes.length) return null;
                  return {
                    pos: line.from,
                    end: line.to,
                    above: true,
                    create: () => {
                      const dom = document.createElement("div");
                      dom.className = "tour-line-tooltip";
                      dom.setAttribute("role", "tooltip");
                      const label = document.createElement("strong");
                      label.textContent = `Guide comment · L${number}`;
                      dom.append(label);
                      for (const note of notes) {
                        const p = document.createElement("p");
                        p.textContent = note.text;
                        dom.append(p);
                      }
                      const button = document.createElement("button");
                      button.textContent = "Discuss this line";
                      button.onclick = () => choose(view, line.from);
                      dom.append(button);
                      return { dom };
                    },
                  };
                },
                { hoverTime: 250 },
              ),
            ]
          : []),
        EditorView.updateListener.of((update) => {
          if (
            update.selectionSet &&
            update.transactions.some((tr) => tr.isUserEvent("select")) &&
            !update.transactions.some((tr) =>
              tr.effects.some((e) => e.is(selectedRange)),
            )
          ) {
            const { from, to } = update.state.selection.main;
            choose(update.view, from, to);
          }
        }),
        highlightActiveLineGutter(),
        ...(tour ? [] : [drawSelection()]),
        foldGutter(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...foldKeymap, ...searchKeymap]),
        search({ top: true }),
        highlightSelectionMatches(),
        syntaxHighlighting(tour ? tourHighlight : sourceHighlight),
        tour ? tourTheme : theme,
        tour ? tourRangeField : rangeField,
        ...(tour ? [focusField] : []),
        language.of([]),
        EditorView.domEventHandlers({
          mouseup: (event, view) => {
            if (!codeSelection.current || event.metaKey || event.ctrlKey)
              return false;
            const { from, to } = view.state.selection.main;
            // Non-editable readers retain native DOM selections when dragging text.
            const selection = view.contentDOM.ownerDocument.getSelection();
            if (
              selection?.anchorNode &&
              selection.focusNode &&
              view.contentDOM.contains(selection.anchorNode) &&
              view.contentDOM.contains(selection.focusNode)
            ) {
              const a = view.posAtDOM(
                selection.anchorNode,
                selection.anchorOffset,
              );
              const b = view.posAtDOM(
                selection.focusNode,
                selection.focusOffset,
              );
              choose(view, Math.min(a, b), Math.max(a, b));
            } else choose(view, from, to);
            return false;
          },
          click: (event) => {
            const target = (event.target as HTMLElement).closest(
              "[data-reference]",
            );
            if (target && (event.metaKey || event.ctrlKey)) {
              const link = links.find(
                (e) => e.id === target.getAttribute("data-reference"),
              );
              if (link) {
                reference.current(link);
                return true;
              }
            }
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    editor.current = view;
    // CodeMirror hides ordinary gutters from assistive technology. This one has controls.
    if (comments.length)
      view.dom.querySelector(".cm-gutters")?.removeAttribute("aria-hidden");
    const decorations = [];
    for (const link of links) {
      const ref = link.after ?? link.before;
      if (
        !ref ||
        ref.path !== path ||
        ref.startLine - firstLine + 1 > state.doc.lines ||
        ref.endLine < firstLine
      )
        continue;
      const start = state.doc.line(
          Math.max(1, ref.startLine - firstLine + 1),
        ).from,
        end = state.doc.line(
          Math.min(ref.endLine - firstLine + 1, state.doc.lines),
        ).to;
      const name = link.target.split(".").at(-1) ?? link.target;
      const at = content.slice(start, end).indexOf(name);
      if (at >= 0 && name.length)
        decorations.push(
          Decoration.mark({
            class: "cm-reference",
            attributes: {
              "data-reference": link.id,
              title: "⌘/Ctrl-click to inspect definition and references",
            },
          }).range(start + at, start + at + name.length),
        );
    }
    if (decorations.length)
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.decorations.of(Decoration.set(decorations, true)),
        ),
      });
    let active = true;
    const descriptor =
      languages.find((l) => l.filename?.test(path)) ??
      languages.find((l) =>
        l.extensions.includes(path.split(".").at(-1) ?? ""),
      );
    descriptor
      ?.load()
      .then((support) => {
        if (active) {
          view.dispatch({ effects: language.reconfigure(support) });
          if (host.current) host.current.dataset.highlighted = "true";
        }
      })
      .catch(() => {
        /* Plain text remains readable if a grammar is unavailable. */
      });
    return () => {
      active = false;
      view.destroy();
      editor.current = null;
    };
  }, [
    path,
    content,
    links,
    firstLine,
    tour,
    comments,
    focusMode,
    essentialRanges,
  ]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    if (!line) {
      view.dispatch({ effects: refreshHappyPath.of(null) });
      return;
    }
    const number = Math.max(
        1,
        Math.min(line - firstLine + 1, view.state.doc.lines),
      ),
      at = view.state.doc.line(number).from,
      last =
        endLine === undefined
          ? number
          : Math.max(
              number,
              Math.min(endLine - firstLine + 1, view.state.doc.lines),
            ),
      scrollAt = view.state.doc.line(
        tour ? Math.floor((number + last) / 2) : number,
      ).from;
    view.dispatch({
      selection: { anchor: at },
      effects: [
        selectedRange.of({
          line: number,
          endLine:
            endLine === undefined
              ? undefined
              : Math.max(number, endLine - firstLine + 1),
        }),
        EditorView.scrollIntoView(scrollAt, { y: "center" }),
      ],
    });
  }, [
    line,
    endLine,
    path,
    content,
    links,
    firstLine,
    comments,
    focusMode,
    essentialRanges,
  ]);
  return <div className="code-reader" ref={host} />;
}
