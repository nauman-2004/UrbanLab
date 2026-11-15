/**
 * Domain types, mirroring the agent backend (backend/dataset.py, tools.py,
 * analysis.py). The backend is the source of truth: variables, sources and
 * values all arrive over the event stream; nothing is hard-coded here.
 *
 * Every value is a `Cell` with its provenance. A cell without a value is
 * explicitly `missing` with a human-readable `reason`.
 */

/** Systems that can produce a value (backend `Source`). */
export type Source = "costar" | "vexcel";

/** One variable in the approved plan (from the backend's VARIABLE_CATALOG). */
export interface PlanVariable {
  name: string; // e.g. "surface_parking_pct"
  source: Source;
  type: "int" | "float" | "bool" | "category" | string;
  label: string; // e.g. "Surface parking (% of lot)"
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
  /** null when the CoStar record has no coordinates (kept in the dataset, not shown on the map). */
  lat: number | null;
  lng: number | null;
  /** Where the record came from: the CoStar data kit, the costar/ package's synthetic test kit, or the sample CSV. */
  costar_source?: "kit" | "synthetic" | "sample";
  /** Public Matterport Showcase 3D tour (no key needed), when the sponsor index links one to this property. */
  matterport_url?: string | null;
  /** How many Matterport scans are linked to this property (null/absent: no Matterport index configured). */
  matterport_models?: number | null;
  /** Backend-relative URL of the aerial tile the vision model measured. */
  aerial_url?: string;
}

export interface Cell {
  building_id: string;
  variable: string;
  value: number | string | null;
  source: Source;
  confidence: number | null;
  /** e.g. "CoStar kit #1084", "Vexcel tile x.png" */
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

/** The five Deep Agents subagents, in the order the orchestrator runs them. */
export type StepName = "planner" | "data_collector" | "vision_measurer" | "gap_analyst" | "analyst";

export interface Step {
  name: StepName | string;
  status: "pending" | "running" | "done";
  description?: string;
  summary?: string;
}

/** Human-in-the-loop interrupt (DeepAgents `interrupt_on`), one per gated tool call. */
export interface Approval {
  action_id: string;
  kind: "plan" | "tool";
  tool: string;
  args: Record<string, unknown>;
  description: string;
  allowed_decisions: string[];
  /** All actions raised in the same pause share a round. */
  round: number;
  round_size: number;
  status: "pending" | "approved" | "rejected";
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
  kind: "step" | "tool" | "gap" | "approval" | "cell" | "analysis" | "info" | "error";
  text: string;
  detail?: string;
  tag?: string;
}
