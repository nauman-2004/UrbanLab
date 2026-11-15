import type { ApprovalDecision, StudyEvent } from "../events";

export type SourceStatus = "idle" | "connecting" | "playing" | "paused" | "awaiting" | "done" | "error";

export interface SourceListener {
  /** `at` = study clock in ms (replay virtual time, or ms since the stream started for live). */
  onEvent(event: StudyEvent, at: number): void;
  onStatus(status: SourceStatus, detail?: string): void;
}

/**
 * Anything that can drive a study: the live agent backend (SSE) or a recorded
 * copy of its stream (offline demo). The UI only talks to this interface.
 */
export interface StudySource {
  readonly kind: "replay" | "live";
  start(question: string): void;
  /** Answer human-in-the-loop approvals (the agent resumes once a pause's approvals are all answered). */
  answer(decisions: ApprovalDecision[]): Promise<void>;
  /** Current study clock in ms — used for timers and "just filled" highlights. */
  now(): number;
  /** Absolute URL for a backend-relative path (e.g. an aerial tile), or null if unavailable. */
  resolveUrl(path: string): string | null;
  stop(): void;
  // Playback controls — no-ops for live sources.
  pause(): void;
  resume(): void;
  setSpeed(speed: number): void;
}
