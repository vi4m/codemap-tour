import { useEffect, useRef, useState } from "react";
import { ChevronDown, GripHorizontal, X } from "lucide-react";
import type { ScenarioStep, SourceRef } from "../shared/model";

type Position = { x: number; y: number };
export function GuideNote({
  step,
  refs,
  referenceIndex,
  onReference,
  onClose,
  onInteract,
}: {
  step: ScenarioStep;
  refs: SourceRef[];
  referenceIndex: number;
  onReference: (index: number) => void;
  onClose: () => void;
  onInteract: () => void;
}) {
  const element = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const clamp = (point: Position) => {
    const box = element.current?.getBoundingClientRect();
    return {
      x: Math.max(
        8,
        Math.min(point.x, window.innerWidth - (box?.width ?? 290) - 8),
      ),
      y: Math.max(
        8,
        Math.min(point.y, window.innerHeight - (box?.height ?? 200) - 8),
      ),
    };
  };
  useEffect(() => {
    const adjust = () =>
      setPosition((previous) => {
        if (!previous) return previous;
        const next = clamp(previous);
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
    const observer = new ResizeObserver(adjust);
    if (element.current) observer.observe(element.current);
    window.addEventListener("resize", adjust);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", adjust);
    };
  }, []);
  const full =
    step.explanation ?? (step.detail.length > 240 ? step.detail : undefined);
  const summary =
    step.explanation || !full
      ? step.detail
      : `${step.detail.slice(0, 220).replace(/\s+\S*$/, "")}…`;
  return (
    <aside
      ref={element}
      className="tour-note"
      aria-label="Step explanation"
      style={
        position
          ? {
              position: "fixed",
              left: position.x,
              top: position.y,
              right: "auto",
            }
          : undefined
      }
    >
      <div className="tour-note-heading">
        <button
          className="tour-note-drag"
          aria-label="Move guide note"
          title="Drag to move · arrow keys to reposition · Home to reset"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const box = element.current!.getBoundingClientRect();
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: box.left,
              top: box.top,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            onInteract();
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) return;
            setPosition(
              clamp({
                x: current.left + event.clientX - current.x,
                y: current.top + event.clientY - current.y,
              }),
            );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Home") {
              event.preventDefault();
              event.stopPropagation();
              setPosition(null);
              return;
            }
            const delta = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            }[event.key];
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            onInteract();
            const box = element.current!.getBoundingClientRect();
            const amount = event.shiftKey ? 40 : 10;
            setPosition(
              clamp({
                x: box.left + delta[0] * amount,
                y: box.top + delta[1] * amount,
              }),
            );
          }}
        >
          <GripHorizontal size={13} />
          <span className="tour-note-dot" /> GUIDE NOTE
        </button>
        <button onClick={onClose} aria-label="Close explanation">
          <X size={14} />
        </button>
      </div>
      <strong>{step.label}</strong>
      <p>{summary}</p>
      {full && (
        <details
          className="tour-note-expanded"
          key={step.id}
          onToggle={(event) => {
            if (event.currentTarget.open) onInteract();
          }}
        >
          <summary>
            Read more <ChevronDown size={13} />
          </summary>
          <div className="tour-note-long">{full}</div>
        </details>
      )}
      {step.guard && <small>{step.guard}</small>}
      <details>
        <summary>
          Source &amp; context <ChevronDown size={13} />
        </summary>
        <div className="tour-note-details">
          <span>Based on captured source · {step.provenance}</span>
          {refs.map((item, i) => (
            <button
              key={`${item.blob}:${item.startLine}:${i}`}
              onClick={() => onReference(i)}
              className={i === referenceIndex ? "active" : ""}
            >
              {item.path.split("/").at(-1)} · L{item.startLine}–{item.endLine}
            </button>
          ))}
        </div>
      </details>
    </aside>
  );
}
