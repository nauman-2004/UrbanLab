/**
 * Study event stream — THE integration contract between the UrbanLab
 * frontend and the agent backend (LangChain Deep Agents).
 *
 * The UI is a pure function of this stream: it never calls CoStar, Vexcel,
 * Matterport, the LLM or Cartesia directly. The backend emits these events
 * (e.g. over Server-Sent Events, one JSON object per `data:` line) and the
 * frontend reduces them into `StudyState` (see `state/reducer.ts`).
 *
 * In demo mode the same events come from a deterministic replay script
 * (`replay/script.ts`), so the UI works with no backend at all.
 *
 * See docs/INTEGRATION.md for the producer-side mapping.
 */
import type {
  ApprovalRequest,
  Cell,
  Gap,
  InterviewQuestion,
  PropertyInfo,
  Stage,
  StudyPlan,
  Todo,
  Utterance,
  VariableKey,
} from "./types";

export type StudyEvent =
  /** A new study begins. Resets client state. */
  | { type: "study.started"; studyId: string; question: string }
  /** Planner output (Deep Agents: planning step). */
  | { type: "plan.updated"; plan: StudyPlan }
  /** Full todo list snapshot (Deep Agents: `write_todos`). */
  | { type: "todos.updated"; todos: Todo[] }
  /** Coarse pipeline stage for the progress stepper. */
  | { type: "stage.changed"; stage: Stage }
  /** Tool call worth surfacing in the activity log. */
  | { type: "tool.called"; name: string; args?: string; summary?: string; tag?: string }
  /** Deep Agents subagent lifecycle. */
  | { type: "subagent.started"; name: string; task: string; tag?: string }
  | { type: "subagent.finished"; name: string; summary: string }
  /** A building enters the sample (CoStar). */
  | { type: "property.added"; property: PropertyInfo }
  /** One value lands in the dataset. `cell.at` is ignored; the client stamps arrival time. */
  | { type: "cell.filled"; propertyId: string; variable: VariableKey; cell: Omit<Cell, "at"> }
  /** A self-reported value was independently confirmed (or the UI did it manually). */
  | { type: "cell.verified"; propertyId: string; variable: VariableKey; evidenceRef: string }
  /** The agent determined a value cannot be observed from digital sources. */
  | { type: "gap.detected"; gap: Omit<Gap, "status"> }
  | { type: "gap.status"; propertyId: string; variable: VariableKey; status: Gap["status"] }
  /** Human-in-the-loop interrupt (Deep Agents `interrupt_on`). Stream pauses until answered. */
  | { type: "approval.requested"; request: Omit<ApprovalRequest, "status"> }
  /** Voice interview lifecycle (Cartesia). */
  | {
      type: "interview.started";
      interviewId: string;
      propertyId: string;
      contact: string;
      questions: Omit<InterviewQuestion, "status" | "answer">[];
      approvedAt: number;
    }
  | { type: "interview.consent"; interviewId: string; t: number }
  | { type: "interview.utterance"; interviewId: string; utterance: Utterance }
  | { type: "interview.question"; interviewId: string; index: number; status: InterviewQuestion["status"]; answer?: string }
  /** Structured value pulled from the transcript by the LLM (Gemini / Nemotron). */
  | {
      type: "interview.extracted";
      interviewId: string;
      variable: VariableKey;
      value: number;
      confidence: number;
      quoteT: number;
    }
  | { type: "interview.ended"; interviewId: string; elapsed: number }
  /** Analysis + report. The frontend recomputes statistics from the dataset itself. */
  | { type: "analysis.started" }
  | { type: "report.ready"; draft: number };

/** Client → backend commands (POST /studies/:id/commands in the real app). */
export type StudyCommand =
  | { type: "approval.respond"; requestId: string; approved: boolean }
  | { type: "interview.hangup"; interviewId: string }
  | { type: "cell.verify"; propertyId: string; variable: VariableKey; evidenceRef: string };
