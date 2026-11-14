import type { StudyCommand, StudyEvent } from "../events";
import { phaseOne, phaseTwo, type Timed } from "../replay/script";
import type { SourceListener, SourceStatus, StudySource } from "./types";

/**
 * Plays the deterministic replay script on a virtual clock that supports
 * pause / resume / speed changes. Stops at `approval.requested` until the
 * researcher answers, exactly like a Deep Agents interrupt.
 */
export class ReplaySource implements StudySource {
  readonly kind = "replay" as const;
  private queue: Timed[] = [];
  private i = 0;
  private vt = 0; // virtual ms at `wallStart`
  private wallStart = 0;
  private speed = 1;
  private status: SourceStatus = "idle";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private listener: SourceListener) {}

  now(): number {
    return this.status === "playing" ? this.vt + (performance.now() - this.wallStart) * this.speed : this.vt;
  }

  private setStatus(s: SourceStatus) {
    this.status = s;
    this.listener.onStatus(s);
  }

  start(): void {
    this.stop();
    this.queue = phaseOne();
    this.i = 0;
    this.vt = 0;
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
    // Emit every event that is due (several can share a timestamp). The clock
    // keeps running continuously, so a late timer (e.g. a throttled tab)
    // catches up by emitting a burst instead of drifting.
    while (this.i < this.queue.length && this.queue[this.i].at <= this.now() + 1) {
      const { at, event } = this.queue[this.i++];
      this.listener.onEvent(event, at);
      if (event.type === "approval.requested") {
        // Freeze the clock at the interrupt until the researcher answers.
        this.vt = at;
        this.setStatus("awaiting");
        return;
      }
    }
    this.schedule();
  }

  send(command: StudyCommand): void {
    if (command.type === "approval.respond" && this.status === "awaiting") {
      const base = this.vt;
      this.queue = phaseTwo(command.approved, base).map((t) => ({ at: t.at + base, event: t.event }));
      this.i = 0;
      this.wallStart = performance.now();
      this.setStatus("playing");
      this.schedule();
    }
    if (command.type === "cell.verify") {
      const ev: StudyEvent = { type: "cell.verified", propertyId: command.propertyId, variable: command.variable, evidenceRef: command.evidenceRef };
      this.listener.onEvent(ev, this.now());
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
