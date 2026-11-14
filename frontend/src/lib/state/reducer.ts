import type { StudyEvent } from "../events";
import type {
  ApprovalRequest,
  Gap,
  Interview,
  LogEntry,
  PropertyRow,
  Stage,
  StudyPlan,
  Todo,
} from "../types";

export interface StudyState {
  studyId: string | null;
  question: string;
  plan: StudyPlan | null;
  todos: Todo[];
  stage: Stage;
  log: LogEntry[];
  rows: Record<string, PropertyRow>;
  order: string[];
  gaps: Gap[];
  approval: ApprovalRequest | null;
  interviews: Record<string, Interview>;
  interviewOrder: string[];
  activeInterviewId: string | null;
  /** Most recently touched property — the map follows it unless the user picked one. */
  focusId: string | null;
  analysisStarted: boolean;
  reportDraft: number | null;
  subagents: number;
}

export const initialState: StudyState = {
  studyId: null,
  question: "",
  plan: null,
  todos: [],
  stage: "plan",
  log: [],
  rows: {},
  order: [],
  gaps: [],
  approval: null,
  interviews: {},
  interviewOrder: [],
  activeInterviewId: null,
  focusId: null,
  analysisStarted: false,
  reportDraft: null,
  subagents: 0,
};

export type StudyAction =
  | { type: "event"; event: StudyEvent; at: number }
  | { type: "approval"; approved: boolean; at: number }
  | { type: "reset" };

const VAR_LABEL: Record<string, string> = {
  yearBuilt: "year_built",
  lotSf: "lot_sf",
  rbaSf: "rba_sf",
  surfaceSf: "surface_sf",
  garageStalls: "garage_stalls",
  offsiteSpaces: "offsite_spaces",
};

function pushLog(s: StudyState, at: number, e: Omit<LogEntry, "id" | "at">): LogEntry[] {
  return [...s.log, { id: s.log.length + 1, at, ...e }];
}

function patchInterview(s: StudyState, id: string, fn: (iv: Interview) => Interview): StudyState {
  const iv = s.interviews[id];
  if (!iv) return s;
  return { ...s, interviews: { ...s.interviews, [id]: fn(iv) } };
}

export function studyReducer(s: StudyState, action: StudyAction): StudyState {
  if (action.type === "reset") return initialState;
  if (action.type === "approval") return withApproval(s, action.approved, action.at);
  const { event: e, at } = action;

  switch (e.type) {
    case "study.started":
      return { ...initialState, studyId: e.studyId, question: e.question };

    case "plan.updated":
      return { ...s, plan: e.plan };

    case "todos.updated": {
      const newlyDone = e.todos.filter(
        (t) => t.status === "done" && s.todos.find((o) => o.id === t.id)?.status !== "done",
      );
      let log = s.log;
      if (s.todos.length === 0) log = pushLog(s, at, { kind: "todo", text: `write_todos`, detail: `${e.todos.length} steps` });
      else for (const t of newlyDone) log = pushLog({ ...s, log }, at, { kind: "todo", text: `✓ ${t.label}` });
      return { ...s, todos: e.todos, log };
    }

    case "stage.changed":
      return { ...s, stage: e.stage };

    case "tool.called":
      return { ...s, log: pushLog(s, at, { kind: "tool", text: `${e.name}(${e.args ?? ""})`, detail: e.summary, tag: e.tag }) };

    case "subagent.started":
      return {
        ...s,
        subagents: s.subagents + 1,
        log: pushLog(s, at, { kind: "subagent", text: `▸ ${e.name}`, detail: e.task, tag: e.tag }),
      };

    case "subagent.finished":
      return { ...s, log: pushLog(s, at, { kind: "subagent", text: `✓ ${e.name}`, detail: e.summary }) };

    case "property.added":
      if (s.rows[e.property.id]) return s;
      return {
        ...s,
        rows: { ...s.rows, [e.property.id]: { info: e.property, cells: {} } },
        order: [...s.order, e.property.id],
      };

    case "cell.filled": {
      const row = s.rows[e.propertyId];
      if (!row) return s;
      const cell = { ...e.cell, at };
      const next: StudyState = {
        ...s,
        focusId: e.propertyId,
        rows: { ...s.rows, [e.propertyId]: { ...row, cells: { ...row.cells, [e.variable]: cell } } },
      };
      if (e.cell.source === "interview") {
        next.log = pushLog(s, at, {
          kind: "cell",
          text: `cell.filled ${e.propertyId}.${VAR_LABEL[e.variable]} = ${e.cell.value.toLocaleString()}`,
          detail: "self-reported · unverified",
        });
      }
      return next;
    }

    case "cell.verified": {
      const row = s.rows[e.propertyId];
      const cell = row?.cells[e.variable];
      if (!row || !cell) return s;
      return {
        ...s,
        rows: {
          ...s.rows,
          [e.propertyId]: {
            ...row,
            cells: {
              ...row.cells,
              [e.variable]: {
                ...cell,
                verification: "verified",
                evidence: { ...cell.evidence, note: `Verified: ${e.evidenceRef}` },
              },
            },
          },
        },
        log: pushLog(s, at, { kind: "cell", text: `cell.verified ${e.propertyId}.${VAR_LABEL[e.variable]}`, detail: e.evidenceRef }),
      };
    }

    case "gap.detected":
      return {
        ...s,
        gaps: [...s.gaps, { ...e.gap, status: "open" }],
        log: pushLog(s, at, {
          kind: "gap",
          text: `gap ${VAR_LABEL[e.gap.variable]} · ${e.gap.propertyId}`,
          detail: e.gap.reason,
        }),
      };

    case "gap.status":
      return {
        ...s,
        gaps: s.gaps.map((g) =>
          g.propertyId === e.propertyId && g.variable === e.variable ? { ...g, status: e.status } : g,
        ),
      };

    case "approval.requested":
      return {
        ...s,
        approval: { ...e.request, status: "pending" },
        log: pushLog(s, at, { kind: "approval", text: `⏸ ${e.request.title}`, detail: "waiting for researcher" }),
      };

    case "interview.started": {
      const iv: Interview = {
        id: e.interviewId,
        propertyId: e.propertyId,
        contact: e.contact,
        status: "live",
        consent: { approvedAt: e.approvedAt, recording: true },
        questions: e.questions.map((q) => ({ ...q, status: "pending" })),
        transcript: [],
        startedAt: at,
        elapsed: 0,
      };
      return {
        ...s,
        interviews: { ...s.interviews, [iv.id]: iv },
        interviewOrder: [...s.interviewOrder, iv.id],
        activeInterviewId: iv.id,
        focusId: e.propertyId,
        log: pushLog(s, at, { kind: "subagent", text: `▸ field-interviewer`, detail: `${e.propertyId} · ${e.contact}`, tag: "cartesia" }),
      };
    }

    case "interview.consent":
      return patchInterview(s, e.interviewId, (iv) => ({ ...iv, consent: { ...iv.consent, verbalAt: e.t } }));

    case "interview.utterance":
      return patchInterview(s, e.interviewId, (iv) => ({
        ...iv,
        transcript: [...iv.transcript, e.utterance],
        elapsed: Math.max(iv.elapsed, e.utterance.t),
      }));

    case "interview.question":
      return patchInterview(s, e.interviewId, (iv) => ({
        ...iv,
        questions: iv.questions.map((q, i) => (i === e.index ? { ...q, status: e.status, answer: e.answer ?? q.answer } : q)),
      }));

    case "interview.extracted": {
      const next = patchInterview(s, e.interviewId, (iv) => ({
        ...iv,
        extracted: { variable: e.variable, value: e.value, confidence: e.confidence, quoteT: e.quoteT },
      }));
      return {
        ...next,
        log: pushLog(next, at, {
          kind: "tool",
          text: `extract(${VAR_LABEL[e.variable]})`,
          detail: `→ ${e.value.toLocaleString()} · conf ${e.confidence.toFixed(2)}`,
          tag: "gemini",
        }),
      };
    }

    case "interview.ended": {
      const next = patchInterview(s, e.interviewId, (iv) => ({ ...iv, status: "ended", elapsed: e.elapsed }));
      return { ...next, activeInterviewId: s.activeInterviewId === e.interviewId ? null : s.activeInterviewId };
    }

    case "analysis.started":
      return {
        ...s,
        analysisStarted: true,
        log: pushLog(s, at, { kind: "analysis", text: "analyze(spearman, mann_whitney)", detail: "computed on the live dataset" }),
      };

    case "report.ready":
      return { ...s, reportDraft: e.draft, log: pushLog(s, at, { kind: "analysis", text: `report draft ${e.draft} ready` }) };

    default:
      return s;
  }
}

/** Approval responses are local-first: update UI immediately, then tell the source. */
function withApproval(s: StudyState, approved: boolean, at: number): StudyState {
  if (!s.approval) return s;
  return {
    ...s,
    approval: { ...s.approval, status: approved ? "approved" : "denied" },
    gaps: s.gaps.map((g) => (g.status === "open" ? { ...g, status: approved ? "queued" : "declined" } : g)),
    log: pushLog(s, at, {
      kind: "approval",
      text: approved ? "✓ interviews approved" : "✕ interviews declined",
      detail: approved ? `${s.approval.targets.length} calls queued` : "gaps stay open; noted as limitation",
    }),
  };
}
