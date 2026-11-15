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

/**
 * How a value was obtained, independently of which system produced it.
 * - observed: read from a record (e.g. CoStar-reported)
 * - computed: arithmetic on recorded inputs (sums, ratios, parcel-polygon area)
 * - model_estimate: produced by a model (e.g. Vexcel segmentation); carries confidence
 * - self_reported: said by a person in an interview (always starts unverified)
 */
export type Method = "observed" | "computed" | "model_estimate" | "self_reported";

/** Optional provenance details sent by the backend's extended profile. */
export interface Provenance {
  method: Method;
  unit?: string | null;
  confidence?: number | null;
  uncertainty?: string | null;
  inputs?: string[];
}

/** Values are numeric for measured variables; categorical variables (e.g. building class) are text. */
export type CellScalar = number | string | boolean;

export interface Cell<T extends CellScalar = number> {
  value: T;
  source: Source;
  verification: Verification;
  evidence: Evidence;
  /** Optional: method / unit / confidence / uncertainty (backend extended profile). */
  provenance?: Provenance;
  /** Replay/clock time (ms) the value arrived — drives "just filled" highlights. */
  at: number;
}

/** The variables of the built-in parking study template (typed numeric cells). */
export type KnownVariableKey =
  | "yearBuilt"
  | "lotSf"
  | "rbaSf"
  | "surfaceSf"
  | "garageStalls"
  | "offsiteSpaces";

/**
 * Variables collected per building. Keys double as dataset column ids.
 * Any research question can add its own variables (e.g. "occupancy_pct", "building_class").
 */
export type VariableKey = KnownVariableKey | (string & {});

export interface PropertyInfo {
  id: string; // e.g. "B-07"
  costarId: string;
  name: string;
  address: string;
  /** City / state / property type as recorded (absent when not recorded). */
  city?: string;
  state?: string;
  propertyType?: string;
  /** Building class as recorded (e.g. "A", "B", "C"); absent when not recorded. */
  propertyClass?: string;
  /** Recorded tenant occupancy %, absent when the data does not support a figure. Never a placeholder 0. */
  occupancyPct?: number;
  /** Why a field above is absent, e.g. { occupancyPct: "1 of 2 current tenancies have no area" }. */
  missing?: Record<string, string>;
  /** WGS84 */
  lat: number;
  lng: number;
  /** Optional media links filled by integrations. */
  aerialUrl?: string;
  matterportUrl?: string;
  contactRole?: string;
}

export type CellMap = Partial<Record<KnownVariableKey, Cell>> & { [variable: string]: Cell<CellScalar> | undefined };

export interface PropertyRow {
  info: PropertyInfo;
  cells: CellMap;
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
