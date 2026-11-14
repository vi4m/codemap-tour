# CodeMap Tour

A guided code reader beside your Codex conversation. Read a change as a story, with highlighted source, notes, line discussions, and player controls.

## Install in Codex

Requirements: **Codex desktop with plugin UI support**, **Git**, and **Node.js 22.13 or newer** available on your PATH. No separate API key, account, CodeMap desktop app, or speech service is needed.

```sh
codex plugin marketplace add vi4m/codemap-tour
codex plugin add codemap-tour@codemap-tour
```

Restart Codex after the first installation. Mention the **Code Tour** skill (`$codemap-tour:code-tour`) in the conversation where you are working and ask for a tour of your code or changes. Codex prepares a source-cited route and requests its reader in the conversation side panel. You can also open **+ → Code Tour** in that conversation's tab bar. The application-sidebar entry opens a standalone reader.

The marketplace is defined in [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json). Its plugin is [under `plugins/codemap-tour`](plugins/codemap-tour). Ready-to-run bundles are included: installation does **not** require `npm install` or a local build. Users of the earlier `codemap-tour-local` development marketplace should disable that older copy before enabling this one, to avoid two servers with the same name.

To refresh the Git-backed marketplace:

```sh
codex plugin marketplace upgrade codemap-tour
```

Install the updated plugin through Codex and restart the desktop app to replace an already running backend.

## What the reader does

- Starts with **a change map** (directories, new/changed files, and their role in the existing system) and **a concept glossary** (new classes/structs, responsibilities, collaborations, and captured definitions). Both are chapters in the player; opening a source reference previews code with a return button.
- Organizes a tour into logical chapters that can connect several files. Switch files or source fragments without leaving the chapter.
- Captures exact Git revisions or working-tree snapshots. Before/after and diffs use those captured files.
- Shows directory breadcrumbs and overall task context when you hover or click the title.
- Keeps a movable **Guide Note** with a short description and a longer explanation under **Read more**. Move its header with the mouse, or focus the handle and use arrow keys; Home resets its position.
- Marks line comments with subtle gutter dots. Hover the source to read them; the file bar shows their count.
- Lets you select lines and draft a question in the active Codex conversation, including the file, revision, and captured excerpt. The guide note stays visible alongside discussion.
- Offers three editable question templates, starting with **Explain me this more**.
- Offers **Happy Path**: explicitly authored essential fragments in the normal execution path stay emphasized while other lines are dimmed, blurred, or hidden with gap indicators. Chapter highlights and comments do not automatically make a line essential. The effect starts off and has an explicit on/off control.

Play advances chapters every 12 seconds. It does **not** start, stop, or synchronize Codex Voice. Narration remains part of your existing Codex conversation.

Tours are saved separately for each conversation under `~/.codemap-tour/threads/`; the standalone sidebar can show the last prepared tour. Source capture is text-only and bounded; symbolic links and sensitive file names are excluded. Captured source and annotations are local, and are not included in this repository.

## Author a tour

The bundled [Code Tour skill](plugins/codemap-tour/skills/code-tour/SKILL.md) explains the workflow. Tools include:

| Tool                       | Purpose                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tour_publish`             | Prepare a route with short/expanded notes, task context, multiple source files per chapter, line comments, and essential ranges. |
| `tour_open`                | Request the native reader beside the conversation.                                                                               |
| `tour_state`               | Read that conversation's tour and selection.                                                                                     |
| `tour_source`, `tour_diff` | Read captured source and compare versions.                                                                                       |
| `tour_select`              | Change chapter and side.                                                                                                         |
| `tour_annotate`            | Replace line comments for one chapter side.                                                                                      |
| `tour_describe`            | Update explanations, task context, or Happy Path ranges without recapturing code.                                                |

A chapter can cite `after: [{path, revision, startLine, endLine}, ...]` and the corresponding `before` array. Its essential fragments use `happyPath: [{side, path, startLine, endLine}, ...]`. Include a file `path` for comments in multi-file chapters.

New tours supply an `introduction` alongside their code stops. `orientation` contains a summary, directory purposes, and files with explicit change status, role and integration notes. `glossary` contains a summary and named concepts with kind, new/existing status, responsibility, collaboration and a source citation. The server captures these references along with the code route. For an existing tour, `tour_introduce` takes exact references to already captured source and preserves the current chapter unless `selectFirst: true` is requested.

## Develop

```sh
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:ui
npm run build
npm run check:bundle
```

`npm run build` bundles the reader and MCP server, and generates `THIRD_PARTY_NOTICES.md`. Release bundles live under `plugins/codemap-tour/dist/<version>/`; each server serves the reader beside its own versioned bundle. The portable `plugin.json` and `mcp.json` use plugin-root-relative paths supported by the Agent Plugins format.

To test a local checkout:

```sh
codex plugin marketplace add /absolute/path/to/codemap-tour
codex plugin add codemap-tour@codemap-tour
```

Codex CLI can load the tools and skill; displaying the code reader requires a desktop host with MCP Apps UI support.

## License

[MIT](LICENSE). Bundled dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
