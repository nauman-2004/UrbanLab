import type { ApprovalDecision, StudyEvent } from "../events";
import recorded from "../replay/recorded-study.json";
import type { SourceListener, SourceStatus, StudySource } from "./types";

interface Timed {
  at: number;
  event: StudyEvent;
}

/** Real gaps between events are compressed so a recorded study plays in well under a minute. */
const MIN_GAP_MS = 140;
const MAX_GAP_MS = 1400;

function timeline(events: StudyEvent[]): Timed[] {
  let at = 0;
  return events.map((event, i) => {
    if (i > 0) {
      const dt = (event.ts - events[i - 1].ts) * 1000;
      at += Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, dt));
    }
    return { at, event };
  });
}

/**
 * Offline demo: plays a recorded backend event stream (`replay/recorded-study.json`,
 * written by `backend/scripts/record_replay.py`) on a virtual clock with
 * pause / resume / speed. It stops at each approval, like a Deep Agents
 * interrupt, and continues with the recorded run once the researcher approves.
 */
export class ReplaySource implements StudySource {
  readonly kind = "replay" as const;
  private queue: Timed[] = timeline(recorded as unknown as StudyEvent[]);
  private i = 0;
  private vt = 0; // virtual ms at `wallStart`
  private wallStart = 0;
  private speed = 1;
  private status: SourceStatus = "idle";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitingFor = new Set<string>();

  constructor(private listener: SourceListener) {}

  now(): number {
    return this.status === "playing" ? this.vt + (performance.now() - this.wallStart) * this.speed : this.vt;
  }

  /** Recorded tiles are bundled under /replay/tiles (copied from backend/data/tiles). */
  resolveUrl(path: string): string | null {
    return path.startsWith("/tiles/") ? `/replay${path}` : null;
  }

  private setStatus(s: SourceStatus) {
    this.status = s;
    this.listener.onStatus(s);
  }

  start(): void {
    this.stop();
    this.i = 0;
    this.vt = 0;
    this.waitingFor.clear();
    this.setStatus("playing");
    this.wallStart = performance.now();
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (this.status !== "playing") return;
    const next = this.queue[this.i];
    if (!next) {
      this.setStatus("done");
      return;
    }
    const delay = Math.max(0, (next.at - this.now()) / this.speed);
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire() {
    while (this.i < this.queue.length && this.queue[this.i].at <= this.now() + 1) {
      const { at, event } = this.queue[this.i++];
      this.listener.onEvent(event, at);
      if (event.type === "approval_required") this.waitingFor.add(event.data.action_id);
      // Pause once the whole round of approvals has been raised.
      const nextEv = this.queue[this.i]?.event;
      if (this.waitingFor.size && nextEv?.type !== "approval_required") {
        this.vt = at;
        this.setStatus("awaiting");
        return;
      }
      if (event.type === "study_completed" || event.type === "study_failed") {
        this.vt = at;
        this.setStatus("done");
        return;
      }
    }
    this.schedule();
  }

  async answer(decisions: ApprovalDecision[]): Promise<void> {
    for (const d of decisions) this.waitingFor.delete(d.action_id);
    if (this.status === "awaiting" && this.waitingFor.size === 0) {
      this.wallStart = performance.now();
      this.setStatus("playing");
      this.schedule();
    }
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.vt = this.now();
    if (this.timer) clearTimeout(this.timer);
    this.setStatus("paused");
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.wallStart = performance.now();
    this.setStatus("playing");
    this.schedule();
  }

  setSpeed(speed: number): void {
    this.vt = this.now();
    this.wallStart = performance.now();
    this.speed = speed;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.status = "idle";
  }
}
