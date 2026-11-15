/**
 * Domain types, mirroring the agent backend (backend/dataset.py, tools.py,
 * analysis.py). The backend is the source of truth: variables, sources and
 * values all arrive over the event stream; nothing is hard-coded here.
 *
 * Every value is a `Cell` with its provenance. A cell without a value is
 * explicitly `missing` with a human-readable `reason`.
 */

/** Systems that can produce a value (backend `Source`). */
export type Source = "costar" | "vexcel" | "survey";

/** One variable in the approved plan (from the backend's VARIABLE_CATALOG). */
export interface PlanVariable {
  name: string; // e.g. "ev_chargers_installed"
  source: Source;
  type: "int" | "float" | "bool" | "category" | string;
  label: string; // e.g. "EV charging ports installed"
}

export interface StudyPlan {
  hypothesis: string;
  variables: PlanVariable[];
  sample: { city: string; property_type: string; n: number };
}

/** A building in the sample (CoStar record). */
export interface Building {
  building_id: string; // e.g. "B-03"
  costar_id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  property_type?: string | null;
  lat: number;
  lng: number;
  /** Backend-relative URL of the aerial tile the vision model measured. */
  aerial_url?: string;
}

export interface Cell {
  building_id: string;
  variable: string;
  value: number | string | null;
  source: Source;
  confidence: number | null;
  /** e.g. "CoStar #1084", "Vexcel tile x.png", 'call-1a2b @ 00:12: "We have 4…"' */
  evidence_ref: string | null;
  status: "filled" | "missing";
  reason: string | null;
  note: string | null;
  updated_at: number;
}

export interface Gap {
  building_id: string;
  variable: string;
  source: Source;
  reason: string;
}

/** The six Deep Agents subagents, in the order the orchestrator runs them. */
export type StepName = "planner" | "data_collector" | "vision_measurer" | "gap_analyst" | "field_surveyor" | "analyst";

export interface Step {
  name: StepName | string;
  status: "pending" | "running" | "done";
  description?: string;
  summary?: string;
}

/** Human-in-the-loop interrupt (DeepAgents `interrupt_on`), one per gated tool call. */
export interface Approval {
  action_id: string;
  kind: "plan" | "survey" | "tool";
  tool: string;
  args: Record<string, unknown>;
  description: string;
  allowed_decisions: string[];
  /** All actions raised in the same pause share a round. */
  round: number;
  round_size: number;
  status: "pending" | "approved" | "rejected";
}

export interface Utterance {
  speaker: "agent" | "contact";
  text: string;
  /** seconds into the call */
  t: number;
}

export interface Call {
  call_id: string;
  building_id: string;
  contact_role: string;
  consent: boolean;
  transcript: Utterance[];
  duration_s: number;
  /** true while telephony.start_call() is the scripted stub */
  stub: boolean;
}

/** One outcome compared between older and newer buildings (analysis.py). */
export interface Effect {
  variable: string;
  label?: string;
  n: number;
  n_older?: number;
  n_newer?: number;
  mean_older?: number | null;
  mean_newer?: number | null;
  diff_older_minus_newer?: number | null;
  diff_ci95?: [number | null, number | null] | null;
  spearman_rho_vs_year_built?: number | null;
  spearman_p?: number | null;
  mann_whitney_p?: number | null;
  note?: string;
}

export interface DecadeStat {
  variable: string;
  decade: number;
  n: number;
  mean: number | null;
  ci95: [number | null, number | null] | null;
}

export interface Findings {
  era_cutoff?: number;
  n_buildings?: number;
  findings: string[];
  effects: Effect[];
  by_decade?: DecadeStat[];
  chart_spec?: { title?: string; data?: { values: { decade: string; mean: number | null; lo: number | null; hi: number | null; n: number }[] } } | null;
  limitations: string[];
  error?: string;
}

export interface LogEntry {
  id: number;
  at: number;
  kind: "step" | "tool" | "gap" | "approval" | "cell" | "call" | "analysis" | "info" | "error";
  text: string;
  detail?: string;
  tag?: string;
}
