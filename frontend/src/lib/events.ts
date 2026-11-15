/**
 * Study event stream — the integration contract with the agent backend.
 *
 * These are exactly the events backend/events.py emits over SSE
 * (`GET /studies/{id}/events`, one JSON object per `data:` line, `event:` = type).
 * The UI is a pure function of this stream (see `state/reducer.ts`).
 * Replay mode plays a recorded copy of the same stream (`replay/recorded-study.json`).
 *
 * See docs/INTEGRATION.md.
 */
import type { Approval, Building, Call, Cell, Findings, Source, StudyPlan } from "./types";

interface Envelope<T extends string, D> {
  type: T;
  study_id: string;
  /** Monotonic per study; used to drop duplicates when the SSE stream reconnects and replays history. */
  seq: number;
  /** Unix seconds */
  ts: number;
  data: D;
}

export type StudyEvent =
  | Envelope<"study_started", { question: string }>
  | Envelope<"step_started", { step: string; step_id: string; description: string }>
  | Envelope<"step_done", { step: string; step_id: string; summary: string }>
  | Envelope<"tool_called", { step: string | null; name: string; args: Record<string, unknown> }>
  | Envelope<"plan_ready", { plan: StudyPlan }>
  | Envelope<"building_added", { building: Building }>
  | Envelope<"building_updated", { building_id: string; aerial_url?: string }>
  | Envelope<"cell_updated", { cell: Cell }>
  | Envelope<"gap_detected", { building_id: string; variable: string; source: Source; reason: string }>
  | Envelope<"approval_required", Omit<Approval, "status">>
  | Envelope<"call_transcript", Call>
  | Envelope<"findings_ready", Findings>
  | Envelope<"study_completed", { summary: string | null }>
  | Envelope<"study_failed", { error: string; trace?: string }>;

export type StudyEventType = StudyEvent["type"];

export const EVENT_TYPES: StudyEventType[] = [
  "study_started",
  "step_started",
  "step_done",
  "tool_called",
  "plan_ready",
  "building_added",
  "building_updated",
  "cell_updated",
  "gap_detected",
  "approval_required",
  "call_transcript",
  "findings_ready",
  "study_completed",
  "study_failed",
];

export const TERMINAL: StudyEventType[] = ["study_completed", "study_failed"];

/** Answer to one approval (`POST /studies/{id}/approve`). */
export interface ApprovalDecision {
  action_id: string;
  approved: boolean;
  feedback?: string;
}
