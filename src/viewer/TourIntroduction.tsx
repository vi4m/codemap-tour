import { ArrowUpRight, BookOpen, Folder, FileCode2 } from "lucide-react";
import type { IntroductionStep, SourceRef } from "../shared/model";
export type IntroductionPreview = {
  ref: SourceRef;
  label: string;
  detail: string;
  explanation: string;
};
const changeLabels = {
  added: "New",
  modified: "Changed",
  existing: "Existing",
  removed: "Removed",
};
export function TourIntroduction({
  content,
  hidden,
  onPreview,
  onInteract,
}: {
  content: IntroductionStep;
  hidden: boolean;
  onPreview: (source: IntroductionPreview) => void;
  onInteract: () => void;
}) {
  return (
    <section
      className="tour-introduction"
      aria-label={
        content.kind === "orientation" ? "Change map" : "Concept glossary"
      }
      hidden={hidden}
      onPointerDown={onInteract}
      onWheel={onInteract}
      onTouchStart={onInteract}
    >
      <div className="tour-introduction-inner">
        <div className="tour-introduction-eyebrow">
          {content.kind === "orientation" ? (
            <Folder size={17} />
          ) : (
            <BookOpen size={17} />
          )}{" "}
          {content.kind === "orientation"
            ? "01 · ORIENTATION"
            : "02 · CONCEPTS"}
        </div>
        <h1>{content.title}</h1>
        <p className="tour-introduction-summary">{content.summary}</p>
        {content.kind === "orientation" ? (
          <>
            <div className="tour-introduction-count">
              {content.files.filter((file) => file.change === "added").length}{" "}
              new · {content.files.length} files in this tour
            </div>
            {content.directories.map((directory) => {
              const files = content.files.filter((file) => {
                const owners = content.directories
                  .filter(
                    (candidate) =>
                      candidate.path === "." ||
                      file.source.path.startsWith(candidate.path + "/"),
                  )
                  .sort((a, b) => b.path.length - a.path.length);
                return owners[0]?.path === directory.path;
              });
              return (
                <section className="tour-map-directory" key={directory.path}>
                  <h2>
                    <Folder size={16} />
                    <code>
                      {directory.path === "."
                        ? "Repository root"
                        : directory.path + "/"}
                    </code>
                  </h2>
                  <p>{directory.purpose}</p>
                  <div className="tour-map-files">
                    {files.map((file, i) => (
                      <article
                        className="tour-map-file"
                        key={`${file.source.path}:${i}`}
                      >
                        <div className="tour-map-file-heading">
                          <button
                            title={file.source.path}
                            onClick={() =>
                              onPreview({
                                ref: file.source,
                                label: file.source.path.split("/").at(-1)!,
                                detail: file.purpose,
                                explanation: file.integration,
                              })
                            }
                          >
                            <FileCode2 size={15} />
                            <code>
                              {directory.path === "."
                                ? file.source.path
                                : file.source.path.slice(
                                    directory.path.length + 1,
                                  )}
                            </code>
                            <ArrowUpRight size={12} />
                          </button>
                          <span className={`tour-change-badge ${file.change}`}>
                            {changeLabels[file.change]}
                          </span>
                        </div>
                        <p className="tour-map-purpose">{file.purpose}</p>
                        <p className="tour-map-integration">
                          {file.integration}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        ) : (
          <div className="tour-glossary">
            {content.entries.map((entry, i) => (
              <details
                key={`${entry.name}:${entry.source.path}:${i}`}
                open={i === 0 ? true : undefined}
              >
                <summary>
                  <span className="tour-glossary-name">
                    <code>{entry.name}</code>
                    <span>
                      {entry.isNew ? "new " : "existing "}
                      {entry.kind}
                    </span>
                  </span>
                  <span className="tour-glossary-responsibility">
                    {entry.responsibility}
                  </span>
                </summary>
                <div className="tour-glossary-detail">
                  <p>{entry.collaboration}</p>
                  <button
                    onClick={() =>
                      onPreview({
                        ref: entry.source,
                        label: entry.name,
                        detail: entry.responsibility,
                        explanation: entry.collaboration,
                      })
                    }
                  >
                    Open definition <ArrowUpRight size={13} />
                  </button>
                  <small>
                    {entry.source.path} · L{entry.source.startLine}–
                    {entry.source.endLine}
                  </small>
                </div>
              </details>
            ))}
          </div>
        )}
        <p className="tour-introduction-hint">
          Open a source reference to read the captured code, or use Next to
          continue the tour.
        </p>
      </div>
    </section>
  );
}
