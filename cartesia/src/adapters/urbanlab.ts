/**
 * Maps module output onto UrbanLab's canonical data model on `main`
 * (frontend/src/lib/types.ts `Cell` / `Call`, backend/dataset.py), so the
 * dashboard and backend can accept interview evidence without a new model.
 *
 * The shapes are mirrored here (not imported) so this module stays independent
 * of frontend/ and backend/. Keep them in sync with `main`:
 *   - Cell.source "survey"  = interview-sourced (self-reported, unverified)
 *   - Call.transcript       = [{ speaker: "agent" | "contact", text, t }]
 *
 * Event mapping (backend/events.py on main):
 *   VOICE_SESSION_COMPLETED  -> "call_transcript"  (toUrbanLabCall)
 *   EVIDENCE_ADDED           -> "cell_updated"      (toUrbanLabCells, one event per cell)
 */
import type { ResearchContext, VoiceResearchResult } from "../types";

/** Mirror of `Cell` in frontend/src/lib/types.ts on main. */
export interface UrbanLabCell {
  building_id: string;
  variable: string;
  value: number | string | null;
  source: "costar" | "vexcel" | "survey";
  confidence: number | null;
  evidence_ref: string | null;
  status: "filled" | "missing";
  reason: string | null;
  note: string | null;
  updated_at: number;
}

/** Mirror of `Call` in frontend/src/lib/types.ts on main. */
export interface UrbanLabCall {
  call_id: string;
  building_id: string;
  contact_role: string;
  consent: boolean;
  transcript: { speaker: "agent" | "contact"; text: string; t: number }[];
  duration_s: number;
  /** `main` uses this for the scripted telephony stub; true for mock-mode sessions. */
  stub: boolean;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * One cell per requested field, matching main's conventions: booleans as 1/0,
 * missing values as `value: null, status: "missing"` with a reason, and
 * evidence_ref `<call> @ mm:ss: "<quote>"`. Mock sessions are prefixed "STUB "
 * like main's telephony stub, so they are never mistaken for findings.
 */
export function toUrbanLabCells(result: VoiceResearchResult, now = Date.now() / 1000): UrbanLabCell[] {
  const prefix = result.mode === "mock" ? "STUB " : "";
  const turns = new Map(result.transcript.map((t) => [t.id, t]));
  return result.fields.map((f) => {
    const ev = result.evidence.find((e) => e.evidenceId === f.evidenceId);
    if (!ev) {
      return {
        building_id: result.propertyId,
        variable: f.key,
        value: null,
        source: "survey",
        confidence: null,
        evidence_ref: `${prefix}cartesia:${result.sessionId}`,
        status: "missing",
        reason: f.reason ?? "Not answered in the interview.",
        note: f.status === "unknown" ? "Participant did not know." : null,
        updated_at: now,
      };
    }
    const turn = turns.get(ev.transcriptEntryId);
    return {
      building_id: result.propertyId,
      variable: f.key,
      value: typeof ev.value === "boolean" ? (ev.value ? 1 : 0) : ev.value,
      source: "survey",
      confidence: ev.confidence ?? null,
      evidence_ref: `${prefix}cartesia:${result.sessionId} @ ${mmss(turn?.offsetSeconds ?? 0)}: "${ev.quote}"`,
      status: "filled",
      reason: null,
      note: "Self-reported via Cartesia voice interview, unverified.",
      updated_at: now,
    };
  });
}

export function toUrbanLabCall(result: VoiceResearchResult, context: ResearchContext): UrbanLabCall {
  return {
    call_id: `cartesia:${result.sessionId}`,
    building_id: result.propertyId,
    contact_role: context.participantRole ?? "Property manager",
    consent: !result.declined && result.transcript.some((t) => t.role === "participant"),
    transcript: result.transcript
      .filter((t) => t.final && t.text.trim())
      .map((t) => ({ speaker: t.role === "agent" ? "agent" : "contact", text: t.text, t: t.offsetSeconds })),
    duration_s: result.durationSeconds,
    stub: result.mode === "mock",
  };
}
