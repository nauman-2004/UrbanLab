import type { StudyEvent } from "../events";
import type { Approval, Building, Call, Cell, Findings, Gap, LogEntry, Step, StudyPlan } from "../types";

/** The orchestrator's pipeline, in order (backend/agent.py SUBAGENTS). */
export const STEPS: { name: string; label: string }[] = [
  { name: "planner", label: "Plan" },
  { name: "data_collector", label: "Collect" },
  { name: "vision_measurer", label: "Measure" },
  { name: "gap_analyst", label: "Find gaps" },
  { name: "field_surveyor", label: "Survey" },
  { name: "analyst", label: "Analyze" },
];

export interface StudyState {
  studyId: string | null;
  question: string;
  /** Highest event seq applied; older/duplicate events are ignored (SSE reconnects replay history). */
  lastSeq: number;
  plan: StudyPlan | null;
  steps: Step[];
  buildings: Record<string, Building>;
  order: string[];
  /** keyed `${building_id}|${variable}` */
  cells: Record<string, Cell>;
  /** Study-clock ms each cell last arrived — drives "just filled" highlights. */
  cellAt: Record<string, number>;
  gaps: Gap[];
  approvals: Approval[];
  calls: Record<string, Call>;
  callOrder: string[];
  findings: Findings | null;
  summary: string | null;
  error: string | null;
  finished: boolean;
  log: LogEntry[];
  /** Most recently touched building — the map and panel follow it unless the user picked one. */
  focusId: string | null;
  toolCalls: number;
}

export const initialState: StudyState = {
  studyId: null,
  question: "",
  lastSeq: -1,
  plan: null,
  steps: STEPS.map((s) => ({ name: s.name, status: "pending" })),
  buildings: {},
  order: [],
  cells: {},
  cellAt: {},
  gaps: [],
  approvals: [],
  calls: {},
  callOrder: [],
  findings: null,
  summary: null,
  error: null,
  finished: false,
  log: [],
  focusId: null,
  toolCalls: 0,
};

export type StudyAction =
  | { type: "event"; event: StudyEvent; at: number }
  | { type: "answered"; actionId: string; approved: boolean; at: number }
  | { type: "reset"; question?: string };

export const cellKey = (buildingId: string, variable: string) => `${buildingId}|${variable}`;

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${clip(s, 40)}`;
  });
  return clip(parts.join(", "), 90);
}

function log(s: StudyState, at: number, e: Omit<LogEntry, "id" | "at">): LogEntry[] {
  return [...s.log, { id: s.log.length + 1, at, ...e }];
}

function setStep(steps: Step[], name: string, patch: Partial<Step>): Step[] {
  const known = steps.some((s) => s.name === name);
  const base = known ? steps : [...steps, { name, status: "pending" as const }];
  return base.map((s) => (s.name === name ? { ...s, ...patch } : s));
}

export function studyReducer(s: StudyState, action: StudyAction): StudyState {
  if (action.type === "reset") return { ...initialState, question: action.question ?? "" };
  if (action.type === "answered") {
    const ap = s.approvals.find((a) => a.action_id === action.actionId);
    if (!ap) return s;
    return {
      ...s,
      approvals: s.approvals.map((a) => (a.action_id === action.actionId ? { ...a, status: action.approved ? "approved" : "rejected" } : a)),
      log: log(s, action.at, {
        kind: "approval",
        text: `${action.approved ? "✓ approved" : "✕ rejected"} ${ap.tool}`,
        detail: ap.kind === "survey" ? String(ap.args.building_id ?? "") : undefined,
      }),
    };
  }

  const { event: e, at } = action;
  if (e.seq <= s.lastSeq) return s;
  const next = reduceEvent({ ...s, lastSeq: e.seq, studyId: e.study_id }, e, at);
  return next;
}

function reduceEvent(s: StudyState, e: StudyEvent, at: number): StudyState {
  switch (e.type) {
    case "study_started":
      return { ...s, question: e.data.question, log: log(s, at, { kind: "info", text: "study started", detail: e.data.question }) };

    case "step_started":
      return {
        ...s,
        steps: setStep(s.steps, e.data.step, { status: "running", description: e.data.description }),
        log: log(s, at, { kind: "step", text: `▸ ${e.data.step}`, detail: clip(e.data.description, 160) }),
      };

    case "step_done":
      return {
        ...s,
        steps: setStep(s.steps, e.data.step, { status: "done", summary: e.data.summary }),
        log: log(s, at, { kind: "step", text: `✓ ${e.data.step}`, detail: clip(e.data.summary.replace(/\s+/g, " "), 160) }),
      };

    case "tool_called":
      return {
        ...s,
        toolCalls: s.toolCalls + 1,
        log: log(s, at, { kind: "tool", text: `${e.data.name}(${argSummary(e.data.args)})`, tag: e.data.step ?? undefined }),
      };

    case "plan_ready":
      return { ...s, plan: e.data.plan };

    case "building_added": {
      const b = e.data.building;
      return {
        ...s,
        buildings: { ...s.buildings, [b.building_id]: { ...s.buildings[b.building_id], ...b } },
        order: s.order.includes(b.building_id) ? s.order : [...s.order, b.building_id],
        focusId: b.building_id,
      };
    }

    case "building_updated": {
      const b = s.buildings[e.data.building_id];
      if (!b) return s;
      return { ...s, buildings: { ...s.buildings, [b.building_id]: { ...b, aerial_url: e.data.aerial_url ?? b.aerial_url } } };
    }

    case "cell_updated": {
      const c = e.data.cell;
      const k = cellKey(c.building_id, c.variable);
      const prev = s.cells[k];
      const next: StudyState = { ...s, cells: { ...s.cells, [k]: c }, cellAt: { ...s.cellAt, [k]: at }, focusId: c.building_id };
      // Log values as they land, and failures with a reason (not the initial "Not yet collected." placeholders).
      if (c.status === "filled") {
        next.log = log(s, at, { kind: "cell", text: `${c.building_id}.${c.variable} = ${String(c.value)}`, detail: c.evidence_ref ?? undefined, tag: c.source });
      } else if (prev?.status !== "missing" || prev.reason !== c.reason) {
        if (c.reason && !/^Not (yet )?collected\.$/.test(c.reason) && c.source !== "survey") {
          next.log = log(s, at, { kind: "gap", text: `${c.building_id}.${c.variable} missing`, detail: c.reason, tag: c.source });
        }
      }
      return next;
    }

    case "gap_detected": {
      const exists = s.gaps.some((g) => g.building_id === e.data.building_id && g.variable === e.data.variable);
      return {
        ...s,
        gaps: exists ? s.gaps : [...s.gaps, e.data],
        log: exists ? s.log : log(s, at, { kind: "gap", text: `gap ${e.data.building_id}.${e.data.variable}`, detail: e.data.reason, tag: e.data.source }),
      };
    }

    case "approval_required":
      if (s.approvals.some((a) => a.action_id === e.data.action_id)) return s;
      return {
        ...s,
        approvals: [...s.approvals, { ...e.data, status: "pending" }],
        log: log(s, at, {
          kind: "approval",
          text: `⏸ approval required · ${e.data.tool}`,
          detail: e.data.kind === "survey" ? `call ${String(e.data.args.building_id ?? "")}` : e.data.description,
        }),
      };

    case "call_transcript": {
      const c = e.data;
      return {
        ...s,
        calls: { ...s.calls, [c.call_id]: c },
        callOrder: s.callOrder.includes(c.call_id) ? s.callOrder : [...s.callOrder, c.call_id],
        focusId: c.building_id,
        log: log(s, at, {
          kind: "call",
          text: `call ${c.building_id} · ${c.contact_role}`,
          detail: `${c.consent ? "consented" : "declined"} · ${Math.round(c.duration_s)}s${c.stub ? " · STUB transcript" : ""}`,
        }),
      };
    }

    case "findings_ready":
      return { ...s, findings: e.data, log: log(s, at, { kind: "analysis", text: "findings ready", detail: `${e.data.findings.length} findings · ${e.data.limitations.length} limitations` }) };

    case "study_completed":
      return {
        ...s,
        finished: true,
        summary: e.data.summary,
        steps: s.steps.map((st) => (st.status === "running" ? { ...st, status: "done" } : st)),
        log: log(s, at, { kind: "analysis", text: "study completed" }),
      };

    case "study_failed":
      return { ...s, finished: true, error: e.data.error, log: log(s, at, { kind: "error", text: "study failed", detail: clip(e.data.error, 300) }) };

    default:
      return s;
  }
}

/** Approvals still waiting for a human, grouped by the pause (round) that raised them. */
export function pendingRound(s: StudyState): Approval[] {
  const pending = s.approvals.filter((a) => a.status === "pending");
  if (!pending.length) return [];
  const round = Math.min(...pending.map((a) => a.round));
  return pending.filter((a) => a.round === round);
}

export function buildingName(s: StudyState, id: string): string {
  return s.buildings[id]?.name ?? id;
}

export function currentStepIndex(s: StudyState): number {
  const running = s.steps.findIndex((st) => st.status === "running");
  if (running >= 0) return running;
  const lastDone = s.steps.map((st) => st.status).lastIndexOf("done");
  return lastDone;
}
