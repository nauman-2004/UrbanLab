/**
 * Public types of the UrbanLab Cartesia voice-research module.
 *
 * The module is study-agnostic: everything study-specific arrives in a
 * `ResearchContext` (IN), and everything collected leaves as a
 * `VoiceResearchResult` plus `VoiceEvent`s (OUT). It never touches the
 * dashboard's map, table, charts or CoStar data.
 *
 * Provenance follows UrbanLab's canonical model on `main`
 * (frontend/src/lib/types.ts `Cell`, backend/dataset.py): interview values are
 * self-reported and UNVERIFIED. See `adapters/urbanlab.ts` for the mapping.
 */

// ------------------------------------------------------------------ IN ----

export type EvidenceValueType = "boolean" | "integer" | "number" | "text";

/** One piece of evidence the study still needs for this property. */
export interface MissingEvidenceField {
  /** Stable variable key, e.g. "current_charger_count". Matches the dashboard's variable name. */
  key: string;
  /** Human label, e.g. "Current charger count". */
  label: string;
  /** What exactly counts as an answer; shown to the interviewer. */
  description?: string;
  /** Expected answer type, so the extractor can normalise ("six" -> 6). */
  type: EvidenceValueType;
  required: boolean;
}

/** Everything the voice module needs to run one interview. Built by the host (dashboard / backend). */
export interface ResearchContext {
  studyId: string;
  propertyId: string;
  propertyName?: string;
  researchQuestion: string;
  /** Role of the person being interviewed, e.g. "Property manager". Never a personal name. */
  participantRole?: string;
  missingEvidence: MissingEvidenceField[];
  /**
   * Host-side context (e.g. CoStar fields) for the host's own use.
   * SECURITY: never forwarded to Cartesia. Only `propertyName`, `researchQuestion`,
   * `participantRole` and the `missingEvidence` labels/descriptions reach the voice agent.
   */
  knownContext?: Record<string, unknown>;
}

// ----------------------------------------------------------- TRANSCRIPT ----

export type TranscriptRole = "agent" | "participant";

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  text: string;
  /** ISO-8601 wall-clock time the turn started. */
  timestamp: string;
  /** Seconds since the session started (for evidence refs like "@ 00:12"). */
  offsetSeconds: number;
  /** false while the turn is still streaming in. */
  final: boolean;
  /** The participant barged in over this agent turn. */
  interrupted?: boolean;
}

// ------------------------------------------------------------- EVIDENCE ----

/** Provenance vocabulary shared with UrbanLab (`main` uses "survey" for interview-sourced cells). */
export type EvidenceVerification = "unverified" | "verified";

/** One structured value extracted from the interview. Always self-reported. */
export interface EvidenceValue {
  field: string;
  value: boolean | number | string;
  source: "cartesia";
  method: "interview";
  /** Interview answers are never independently verified by this module. */
  verification: "unverified";
  confidence?: number | null;
  /** Stable id for this piece of evidence, e.g. "ev-<session>-current_charger_count". */
  evidenceId: string;
  /** The participant's own words supporting the value. */
  quote: string;
  /** Which transcript entry the quote came from. */
  transcriptEntryId: string;
  /** Which extractor produced it ("mock" is clearly not AI). */
  extractor: string;
}

/** A field the participant explicitly could not answer. Preserved as unknown, never guessed. */
export interface UnknownEvidence {
  field: string;
  reason: string;
  quote?: string;
  transcriptEntryId?: string;
}

export interface ExtractionOutput {
  values: EvidenceValue[];
  unknown: UnknownEvidence[];
  /** The participant refused to take part; nothing should be recorded as collected. */
  declined?: boolean;
}

/**
 * Turns a transcript into structured evidence. Pluggable: `MockEvidenceExtractor`
 * for the standalone demo; a Gemini (or UrbanLab backend) adapter later.
 */
export interface EvidenceExtractor {
  readonly name: string;
  /** True for the scripted demo extractor, so the UI can label it. */
  readonly isMock: boolean;
  extract(context: ResearchContext, transcript: TranscriptEntry[], sessionId: string): Promise<ExtractionOutput>;
}

// --------------------------------------------------------------- RESULT ----

export type FieldOutcomeStatus = "collected" | "unknown" | "missing";

/** Per requested field: what happened. `value` stays null unless evidence was collected. */
export interface FieldOutcome {
  key: string;
  label: string;
  required: boolean;
  status: FieldOutcomeStatus;
  value: EvidenceValue["value"] | null;
  evidenceId: string | null;
  reason: string | null;
}

export type VoiceResearchStatus = "complete" | "partial" | "cancelled" | "failed";

export interface VoiceResearchResult {
  sessionId: string;
  studyId: string;
  propertyId: string;
  mode: VoiceMode;
  status: VoiceResearchStatus;
  transcript: TranscriptEntry[];
  evidence: EvidenceValue[];
  fields: FieldOutcome[];
  startedAt: string | null;
  endedAt: string;
  durationSeconds: number;
  extractor: { name: string; isMock: boolean } | null;
  /** Set when status is failed/partial because something went wrong. */
  error: VoiceError | null;
  /** Participant declined to take part (consent refused). */
  declined: boolean;
}

// ------------------------------------------------------------ SESSION ----

export type VoiceMode = "live" | "mock";

export type VoiceSessionStatus =
  | "idle" // no context loaded
  | "awaiting_approval" // context loaded, nothing connected
  | "cancelled" // user cancelled before starting; no connection was ever made
  | "requesting_microphone"
  | "connecting"
  | "live"
  | "ending"
  | "extracting"
  | "done" // result available (complete or partial)
  | "failed";

export type VoiceErrorKind =
  | "approval_required"
  | "microphone_denied"
  | "microphone_unavailable"
  | "config_missing"
  | "auth_failed"
  | "agent_not_found"
  | "rate_limited"
  | "connection_failed"
  | "disconnected"
  | "agent_error"
  | "no_transcript"
  | "extraction_failed"
  | "unknown";

export interface VoiceError {
  kind: VoiceErrorKind;
  /** Human-readable, safe to show (never contains tokens or keys). */
  message: string;
}

/** Proof that a human approved this exact context. Required by `startSession`. */
export interface VoiceApproval {
  approvalId: string;
  studyId: string;
  propertyId: string;
  /** Field keys the approver saw. */
  fieldKeys: string[];
  approvedAt: string;
}

// --------------------------------------------------------------- EVENTS ----

interface EventBase<T extends string> {
  type: T;
  sessionId: string;
  studyId: string;
  propertyId: string;
  /** ISO-8601 */
  at: string;
}

/**
 * Events the module emits for the host. Names follow the spec; the mapping onto
 * UrbanLab's backend stream (`call_transcript`, `cell_updated`, ...) is in
 * `adapters/urbanlab.ts` and the README.
 */
export type VoiceEvent =
  | (EventBase<"VOICE_SESSION_APPROVED"> & { approval: VoiceApproval })
  | (EventBase<"VOICE_SESSION_CANCELLED"> & { reason: "user_cancelled_before_start" })
  | (EventBase<"VOICE_SESSION_STARTED"> & { mode: VoiceMode })
  | (EventBase<"VOICE_TRANSCRIPT_UPDATED"> & { entry: TranscriptEntry })
  | (EventBase<"VOICE_EVIDENCE_EXTRACTED"> & { output: ExtractionOutput; extractor: string })
  | (EventBase<"VOICE_SESSION_COMPLETED"> & { result: VoiceResearchResult })
  | (EventBase<"VOICE_SESSION_FAILED"> & { error: VoiceError; result: VoiceResearchResult | null })
  /** Emitted by the HOST (via `acceptEvidence`) once it accepts values into its dataset. */
  | (EventBase<"EVIDENCE_ADDED"> & { evidence: EvidenceValue[] });

export type VoiceEventType = VoiceEvent["type"];
export type VoiceEventListener = (event: VoiceEvent) => void;
