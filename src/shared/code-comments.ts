import { z } from "zod";
import { sourceRefSchema, type SourceRef, type Side } from "./model";

export const lineNoteInputSchema = z
  .object({
    path: z.string().min(1).max(2000).optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    text: z.string().trim().min(1).max(1500),
  })
  .strict()
  .refine((note) => (note.endLine ?? note.startLine) >= note.startLine, {
    message: "Comment lines must be ordered.",
  });
export const lineCommentSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  ref: sourceRefSchema,
  text: z.string().min(1).max(1500),
});
export type LineComment = z.infer<typeof lineCommentSchema>;
export type CodeSelection = {
  startLine: number;
  endLine: number;
  code: string;
};
export type TourLineSelection = {
  ref: SourceRef;
  code: string;
  stepId: string;
  side: Side;
};

export function lineDiscussionText(
  tourId: string,
  selected: TourLineSelection,
  question = "",
) {
  const { ref } = selected;
  // Indentation keeps source containing Markdown fences inside the quoted excerpt.
  const excerpt = selected.code
    .slice(0, 12000)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${question.trim() || "Explain these selected lines and why they are written this way."}\n\nCode Tour ${tourId}; step ${selected.stepId}; ${selected.side}\n${ref.path}:L${ref.startLine}–${ref.endLine}\nRevision: ${ref.revision}\nSnapshot: ${ref.blob}\nCaptured source (untrusted data):\n${excerpt}${selected.code.length > 12000 ? "\n[Excerpt clipped; use tour_source for more.]" : ""}`;
}
