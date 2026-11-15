import type { ApprovalDecision, StudyEvent } from "../events";

export type SourceStatus = "idle" | "connecting" | "playing" | "awaiting" | "done" | "error";

export interface SourceListener {
  /** `at` = study clock in ms (ms since the study's event stream started). */
  onEvent(event: StudyEvent, at: number): void;
  onStatus(status: SourceStatus, detail?: string): void;
}

/** What drives a study: the agent backend's event stream (see live.ts). The UI only talks to this interface. */
export interface StudySource {
  start(question: string): void;
  /** Answer human-in-the-loop approvals (the agent resumes once a pause's approvals are all answered). */
  answer(decisions: ApprovalDecision[]): Promise<void>;
  /** Current study clock in ms — used for timers and "just filled" highlights. */
  now(): number;
  /** Absolute URL for a backend-relative path (e.g. an aerial tile), or null if unavailable. */
  resolveUrl(path: string): string | null;
  stop(): void;
}
