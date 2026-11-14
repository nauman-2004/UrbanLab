/**
 * Core domain types for UrbanLab.
 *
 * Every measured value in a study is a `Cell` that carries its provenance
 * (which system produced it) and, for self-reported values, a verification
 * status. The UI never shows a number without being able to say where it
 * came from.
 */

/** Systems that can produce a value in the dataset. */
export type Source =
  | "costar" // CoStar property records (incl. parking notes)
  | "vexcel" // Vexcel aerial imagery, measured by a vision model
  | "matterport" // Matterport 3D scans
  | "interview" // Cartesia voice interview, extracted by the LLM
  | "derived"; // Computed by UrbanLab from other cells

/**
 * Self-reported values (interviews) start `unverified` and only become
 * `verified` when independently confirmed (e.g. a lease document).
 * Values from records / imagery / scans are `observed`.
 */
export type Verification = "observed" | "unverified" | "verified";

export interface Evidence {
  /** Human-readable reference, e.g. "CoStar #1084-221" or "iv-07 @ 00:12". */
  ref: string;
  /** Optional deep link to the underlying record / image / scan / recording. */
  url?: string;
  /** Short quote for interview-derived values. */
  quote?: string;
  /** Model confidence 0..1 for machine-extracted values. */
  confidence?: number;
  /** Free-text note, e.g. "inferred from CoStar parking notes — no 3D scan". */
  note?: string;
}

export interface Cell<T = number> {
  value: T;
  source: Source;
  verification: Verification;
  evidence: Evidence;
  /** Replay/clock time (ms) the value arrived — drives "just filled" highlights. */
  at: number;
}

/** Variables collected per building. Keys double as dataset column ids. */
export type VariableKey =
  | "yearBuilt"
  | "lotSf"
  | "rbaSf"
  | "surfaceSf"
  | "garageStalls"
  | "offsiteSpaces";

export interface PropertyInfo {
  id: string; // e.g. "B-07"
  costarId: string;
  name: string;
  address: string;
  propertyClass: "A" | "B";
  occupancyPct: number;
  /** WGS84 */
  lat: number;
  lng: number;
  /** Optional media links filled by integrations. */
  aerialUrl?: string;
  matterportUrl?: string;
  contactRole?: string;
}

export interface PropertyRow {
  info: PropertyInfo;
  cells: Partial<Record<VariableKey, Cell>>;
}

export interface Gap {
  propertyId: string;
  variable: VariableKey;
  reason: string;
  status: "open" | "queued" | "collecting" | "filled" | "declined";
}

export type TodoStatus = "pending" | "running" | "done";
export interface Todo {
  id: string;
  label: string;
  status: TodoStatus;
  detail?: string;
}

export interface StudyPlan {
  question: string;
  hypothesis: string;
  variables: { key: VariableKey; label: string; source: Source }[];
  sample: string;
}

export type Stage = "plan" | "collect" | "measure" | "fill" | "analyze" | "report";

export interface LogEntry {
  id: number;
  at: number;
  kind: "todo" | "tool" | "subagent" | "gap" | "approval" | "cell" | "analysis" | "info";
  text: string;
  detail?: string;
  /** e.g. "gemini", "cartesia" — rendered as a small model badge. */
  tag?: string;
}

export interface Utterance {
  speaker: "agent" | "contact";
  text: string;
  /** seconds into the call */
  t: number;
  /** substring to highlight as the extracted answer */
  highlight?: string;
}

export interface InterviewQuestion {
  text: string;
  maps: VariableKey | "context";
  status: "pending" | "asking" | "answered";
  answer?: string;
}

export interface Interview {
  id: string; // e.g. "iv-07"
  propertyId: string;
  contact: string;
  status: "dialing" | "live" | "ended";
  consent: { approvedAt?: number; verbalAt?: number; recording: boolean };
  questions: InterviewQuestion[];
  transcript: Utterance[];
  extracted?: { variable: VariableKey; value: number; confidence: number; quoteT: number };
  startedAt: number;
  /** seconds elapsed on the call (updated by events) */
  elapsed: number;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  purpose: string;
  targets: { propertyId: string; contact: string }[];
  questions: string[];
  status: "pending" | "approved" | "denied";
}
