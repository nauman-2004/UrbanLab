import type { StudyCommand, StudyEvent } from "../events";
import type { SourceListener, StudySource } from "./types";

/**
 * Live backend adapter (not used in demo mode).
 *
 * Expected backend endpoints — see docs/INTEGRATION.md:
 *   POST {base}/studies                     { question }        → { studyId }
 *   GET  {base}/studies/{id}/events         text/event-stream   (one StudyEvent JSON per `data:` line)
 *   POST {base}/studies/{id}/commands       StudyCommand        → 202
 */
export class LiveSource implements StudySource {
  readonly kind = "live" as const;
  private es: EventSource | null = null;
  private studyId: string | null = null;
  private t0 = 0;

  constructor(private base: string, private listener: SourceListener) {}

  now(): number {
    return this.t0 ? performance.now() - this.t0 : 0;
  }

  async start(question: string): Promise<void> {
    this.stop();
    try {
      const res = await fetch(`${this.base}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error(`POST /studies → ${res.status}`);
      const { studyId } = (await res.json()) as { studyId: string };
      this.studyId = studyId;
      this.t0 = performance.now();
      this.es = new EventSource(`${this.base}/studies/${studyId}/events`);
      this.listener.onStatus("playing");
      this.es.onmessage = (m) => {
        const event = JSON.parse(m.data) as StudyEvent;
        this.listener.onEvent(event, this.now());
        if (event.type === "approval.requested") this.listener.onStatus("awaiting");
        if (event.type === "report.ready") this.listener.onStatus("done");
      };
      this.es.onerror = () => this.listener.onStatus("error");
    } catch (err) {
      console.error("[UrbanLab] live source failed", err);
      this.listener.onStatus("error");
    }
  }

  send(command: StudyCommand): void {
    if (!this.studyId) return;
    if (command.type === "approval.respond") this.listener.onStatus("playing");
    void fetch(`${this.base}/studies/${this.studyId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  }

  stop(): void {
    this.es?.close();
    this.es = null;
  }

  pause(): void {}
  resume(): void {}
  setSpeed(): void {}
}
