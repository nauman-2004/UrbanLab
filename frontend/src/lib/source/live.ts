import { EVENT_TYPES, TERMINAL, type ApprovalDecision, type StudyEvent } from "../events";
import type { SourceListener, StudySource } from "./types";

/**
 * Live agent backend (backend/main.py):
 *   POST {base}/studies                  { question }                          → { study_id }
 *   GET  {base}/studies/{id}/events      text/event-stream (`event:` = type, `data:` = StudyEvent JSON)
 *   POST {base}/studies/{id}/approve     { action_id, approved, feedback? }    → 202
 *
 * The SSE stream replays history on (re)connect; the reducer drops duplicates by `seq`.
 */
export class LiveSource implements StudySource {
  private es: EventSource | null = null;
  private studyId: string | null = null;
  private t0 = 0;
  private pending = new Set<string>();

  constructor(private base: string, private listener: SourceListener) {
    this.base = base.replace(/\/+$/, "");
  }

  now(): number {
    return this.t0 ? performance.now() - this.t0 : 0;
  }

  resolveUrl(path: string): string | null {
    return /^https?:/.test(path) ? path : `${this.base}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  async start(question: string): Promise<void> {
    this.stop();
    this.pending.clear();
    this.listener.onStatus("connecting");
    try {
      const res = await fetch(`${this.base}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error(`POST /studies → ${res.status} ${await res.text()}`);
      const { study_id } = (await res.json()) as { study_id: string };
      this.studyId = study_id;
      this.t0 = performance.now();
      const es = new EventSource(`${this.base}/studies/${study_id}/events`);
      this.es = es;
      this.listener.onStatus("playing");
      // The backend names every SSE event, so `onmessage` never fires: listen per type.
      for (const type of EVENT_TYPES) es.addEventListener(type, (m) => this.handle(JSON.parse((m as MessageEvent).data) as StudyEvent));
      es.onerror = () => {
        // The browser reconnects on its own; only report an error if the stream is gone for good.
        if (es.readyState === EventSource.CLOSED) this.listener.onStatus("error", "Lost connection to the agent backend.");
      };
    } catch (err) {
      console.error("[UrbanLab] live source failed", err);
      this.listener.onStatus("error", `Could not reach the agent backend at ${this.base}. Is it running?`);
    }
  }

  private handle(event: StudyEvent) {
    this.listener.onEvent(event, this.now());
    if (event.type === "approval_required") {
      this.pending.add(event.data.action_id);
      this.listener.onStatus("awaiting");
    }
    if (TERMINAL.includes(event.type)) {
      this.listener.onStatus(event.type === "study_failed" ? "error" : "done", event.type === "study_failed" ? event.data.error : undefined);
      this.stop();
    }
  }

  async answer(decisions: ApprovalDecision[]): Promise<void> {
    if (!this.studyId) return;
    for (const d of decisions) {
      const res = await fetch(`${this.base}/studies/${this.studyId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!res.ok && res.status !== 404) throw new Error(`POST /approve → ${res.status}`);
      this.pending.delete(d.action_id);
    }
    if (this.pending.size === 0) this.listener.onStatus("playing");
  }

  stop(): void {
    this.es?.close();
    this.es = null;
  }
}
