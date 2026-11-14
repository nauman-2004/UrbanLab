import type { StudyCommand, StudyEvent } from "../events";

export type SourceStatus = "idle" | "playing" | "paused" | "awaiting" | "done" | "error";

export interface SourceListener {
  /** `at` = study clock in ms (replay virtual time, or ms since stream start for live). */
  onEvent(event: StudyEvent, at: number): void;
  onStatus(status: SourceStatus): void;
}

/**
 * Anything that can drive a study: the deterministic replay (demo) or the
 * live agent backend (SSE). The UI only talks to this interface.
 */
export interface StudySource {
  readonly kind: "replay" | "live";
  start(question: string): void;
  send(command: StudyCommand): void;
  /** Current study clock in ms — used for timers and "just filled" highlights. */
  now(): number;
  stop(): void;
  // Playback controls — no-ops for live sources.
  pause(): void;
  resume(): void;
  setSpeed(speed: number): void;
}
