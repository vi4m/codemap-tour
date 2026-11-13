import { createHash } from "node:crypto";
import path from "node:path";
import { TourSession } from "./snapshots";

export class ConversationTours {
  readonly latest: TourSession;
  private sessions = new Map<string, TourSession>();
  private globalReaders = new Set<string>();
  constructor(private readonly directory: string) {
    this.latest = new TourSession(path.join(directory, "active.json"));
  }
  private id(extra: { _meta?: Record<string, unknown> }) {
    const id = extra._meta?.threadId;
    if (typeof id !== "string" || !id.trim() || id.length > 200)
      throw new Error(
        "Codex did not provide a conversation ID. Reopen Code Tour in the conversation.",
      );
    return id;
  }
  forThread(id: string) {
    let session = this.sessions.get(id);
    if (!session) {
      const key = createHash("sha256").update(id).digest("hex");
      session = new TourSession(
        path.join(this.directory, "threads", `${key}.json`),
        id,
      );
      this.sessions.set(id, session);
    }
    return session;
  }
  sidebar(extra: { _meta?: Record<string, unknown> }) {
    this.globalReaders.add(this.id(extra));
    return this.latest;
  }
  session(extra: { _meta?: Record<string, unknown> }, inConversation = false) {
    const id = this.id(extra);
    if (inConversation) this.globalReaders.delete(id);
    return this.globalReaders.has(id) ? this.latest : this.forThread(id);
  }
  state(extra: { _meta?: Record<string, unknown> }, inConversation = false) {
    const session = this.session(extra, inConversation);
    const tour = session.current();
    return {
      tour,
      context: {
        threadId: this.id(extra),
        scope: session === this.latest ? "sidebar" : "conversation",
        hasOtherTour: !tour && !!this.latest.current(),
      },
    };
  }
  remember(session: TourSession) {
    if (session !== this.latest)
      session.saveTo(path.join(this.directory, "active.json"));
  }
}
