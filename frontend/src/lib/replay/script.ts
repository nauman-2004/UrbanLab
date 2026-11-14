/**
 * Deterministic research replay. Produces the exact event stream a live
 * backend would emit, from the synthetic dataset. Times are in ms at 1× speed.
 *
 * The script is split at the human-in-the-loop interrupt: phase 1 runs until
 * `approval.requested`; phase 2 depends on the researcher's answer.
 * Total runtime ≈ 60 s at 1× (≈ 30 s at 2×) — sized for a two-minute demo.
 */
import { BUILDINGS, INTERVIEWS, INTERVIEW_QUESTIONS, STUDY, type SyntheticBuilding } from "../data/houston";
import type { StudyEvent } from "../events";
import type { Todo, VariableKey } from "../types";

export interface Timed { at: number; event: StudyEvent }

const TODOS: Omit<Todo, "status" | "detail">[] = [
  { id: "plan", label: "Define sample & variables" },
  { id: "costar", label: "Pull CoStar records" },
  { id: "measure", label: "Measure lots (Vexcel + Matterport)" },
  { id: "gaps", label: "Fill evidence gaps" },
  { id: "analyze", label: "Analyze" },
  { id: "report", label: "Critique & report" },
];

function todos(doneUpTo: number, running?: number, detail?: string): Todo[] {
  return TODOS.map((t, i) => ({
    ...t,
    status: i < doneUpTo ? "done" : i === running ? "running" : "pending",
    detail: i === running ? detail : undefined,
  }));
}

const gapBuildings = () => BUILDINGS.filter((b) => b.offsiteSource === "interview");

function costarCells(b: SyntheticBuilding): { variable: VariableKey; value: number }[] {
  return [
    { variable: "yearBuilt", value: b.yearBuilt },
    { variable: "rbaSf", value: b.rbaSf },
    { variable: "lotSf", value: b.lotSf },
  ];
}

export function phaseOne(): Timed[] {
  const out: Timed[] = [];
  let t = 0;
  const at = (dt: number, event: StudyEvent) => { t += dt; out.push({ at: t, event }); };

  at(0, { type: "study.started", studyId: STUDY.id, question: STUDY.question });
  at(600, {
    type: "plan.updated",
    plan: {
      question: STUDY.question,
      hypothesis: STUDY.hypothesis,
      sample: STUDY.sample,
      variables: [
        { key: "yearBuilt", label: "year_built", source: "costar" },
        { key: "lotSf", label: "lot_sf", source: "costar" },
        { key: "surfaceSf", label: "surface_sf", source: "vexcel" },
        { key: "garageStalls", label: "garage_stalls", source: "matterport" },
        { key: "offsiteSpaces", label: "offsite_spaces", source: "interview" },
      ],
    },
  });
  at(300, { type: "todos.updated", todos: todos(0, 0) });
  at(900, { type: "todos.updated", todos: todos(1, 1) });
  at(0, { type: "stage.changed", stage: "collect" });

  // ── CoStar ──────────────────────────────────────────────
  at(500, { type: "tool.called", name: "costar.search", args: "type=office, market=HOU-CBD", summary: `→ ${BUILDINGS.length} properties` });
  for (const b of BUILDINGS) {
    at(220, { type: "property.added", property: b.info });
    for (const c of costarCells(b)) {
      at(0, {
        type: "cell.filled", propertyId: b.info.id, variable: c.variable,
        cell: { value: c.value, source: "costar", verification: "observed", evidence: { ref: `CoStar #${b.info.costarId}` } },
      });
    }
  }
  // CoStar parking notes cover off-site leases for most buildings.
  at(500, { type: "tool.called", name: "costar.parking_notes", args: "12 properties", summary: "→ off-site leases found for 9 / 12" });
  for (const b of BUILDINGS.filter((x) => x.offsiteSource === "costar")) {
    at(90, {
      type: "cell.filled", propertyId: b.info.id, variable: "offsiteSpaces",
      cell: { value: b.offsiteSpaces, source: "costar", verification: "observed", evidence: { ref: `CoStar #${b.info.costarId} · parking notes` } },
    });
  }
  at(400, { type: "todos.updated", todos: todos(2, 2) });
  at(0, { type: "stage.changed", stage: "measure" });

  // ── Vexcel (vision model) ───────────────────────────────
  at(300, { type: "subagent.started", name: "aerial-measurer", task: "segment surface lots in Vexcel ortho tiles", tag: "gemini" });
  for (const b of BUILDINGS) {
    at(420, {
      type: "cell.filled", propertyId: b.info.id, variable: "surfaceSf",
      cell: {
        value: b.surfaceSf, source: "vexcel", verification: "observed",
        evidence: { ref: `Vexcel ortho 2025-06 · tile ${b.info.costarId}`, confidence: b.surfaceConfidence },
      },
    });
  }
  at(300, { type: "subagent.finished", name: "aerial-measurer", summary: `${BUILDINGS.length}/${BUILDINGS.length} lots segmented` });

  // ── Matterport ──────────────────────────────────────────
  const scanned = BUILDINGS.filter((b) => b.garageFromScan);
  at(300, { type: "subagent.started", name: "interior-inspector", task: "count structured parking in Matterport scans" });
  for (const b of BUILDINGS) {
    at(320, {
      type: "cell.filled", propertyId: b.info.id, variable: "garageStalls",
      cell: b.garageFromScan
        ? { value: b.garageStalls, source: "matterport", verification: "observed", evidence: { ref: `Matterport scan mp-${b.info.costarId.replace("-", "")}`, note: `${b.garageLevels} garage level${b.garageLevels === 1 ? "" : "s"}` } }
        : { value: b.garageStalls, source: "costar", verification: "observed", evidence: { ref: `CoStar #${b.info.costarId} · parking notes`, note: `No 3D scan — inferred from CoStar notes (${b.garageLevels} levels)` } },
    });
  }
  at(300, { type: "subagent.finished", name: "interior-inspector", summary: `${scanned.length}/${BUILDINGS.length} scans · ${BUILDINGS.length - scanned.length} inferred from CoStar` });

  // ── Gaps ────────────────────────────────────────────────
  at(600, { type: "todos.updated", todos: todos(3, 3, "Waiting for approval") });
  at(0, { type: "stage.changed", stage: "fill" });
  for (const b of gapBuildings()) {
    at(350, {
      type: "gap.detected",
      gap: { propertyId: b.info.id, variable: "offsiteSpaces", reason: "Off-site parking contracts aren't visible in records, aerials, or 3D scans" },
    });
  }
  at(700, {
    type: "approval.requested",
    request: {
      id: "ap-1",
      title: `Approve ${gapBuildings().length} research interviews`,
      purpose: "Off-site leased parking is needed to compare total parking supply, but no digital source records it. A short voice interview with each building's contact can fill it.",
      targets: gapBuildings().map((b) => ({ propertyId: b.info.id, contact: b.info.contactRole ?? "Property contact" })),
      questions: INTERVIEW_QUESTIONS.map((q) => q.text),
    },
  });
  return out;
}

/** Interview timing: scale script seconds → ms. First call is slower so the audience can follow it. */
const CALL_MS = [620, 300, 300];

export function phaseTwo(approved: boolean, approvedAt: number): Timed[] {
  const out: Timed[] = [];
  let t = 0;
  const at = (dt: number, event: StudyEvent) => { t += dt; out.push({ at: t, event }); };

  if (approved) {
    INTERVIEWS.forEach((iv, n) => {
      const ms = CALL_MS[n] ?? 300;
      const b = BUILDINGS.find((x) => x.info.id === iv.propertyId)!;
      at(n === 0 ? 400 : 1200, { type: "gap.status", propertyId: iv.propertyId, variable: "offsiteSpaces", status: "collecting" });
      at(0, {
        type: "todos.updated",
        todos: todos(3, 3, `Interviewing ${b.info.name} · ${INTERVIEWS.length - n - 1} left`),
      });
      at(0, {
        type: "interview.started", interviewId: iv.interviewId, propertyId: iv.propertyId, contact: iv.contact,
        questions: INTERVIEW_QUESTIONS.map((q) => ({ text: q.text, maps: q.maps })), approvedAt,
      });
      let prevT = 0;
      let q = -1;
      iv.utterances.forEach((u, i) => {
        at((u.t - prevT) * ms + (i === 0 ? 600 : 0), { type: "interview.utterance", interviewId: iv.interviewId, utterance: u });
        prevT = u.t;
        if (i === 1) at(0, { type: "interview.consent", interviewId: iv.interviewId, t: u.t });
        // agent utterances 2,4,6 ask questions 0,1,2; the following contact line answers.
        if (u.speaker === "agent" && i >= 2 && q < 2) {
          q++;
          at(0, { type: "interview.question", interviewId: iv.interviewId, index: q, status: "asking" });
        } else if (u.speaker === "contact" && i >= 2 && q >= 0) {
          at(0, { type: "interview.question", interviewId: iv.interviewId, index: q, status: "answered", answer: iv.questionAnswers[q] });
          if (q === 0) {
            at(800, { type: "interview.extracted", interviewId: iv.interviewId, variable: "offsiteSpaces", value: iv.answer, confidence: iv.confidence, quoteT: iv.quoteT });
            at(500, {
              type: "cell.filled", propertyId: iv.propertyId, variable: "offsiteSpaces",
              cell: {
                value: iv.answer, source: "interview", verification: "unverified",
                evidence: { ref: `${iv.interviewId} @ 00:${String(iv.quoteT).padStart(2, "0")}`, quote: iv.utterances.find((x) => x.t === iv.quoteT)?.text, confidence: iv.confidence },
              },
            });
            at(0, { type: "gap.status", propertyId: iv.propertyId, variable: "offsiteSpaces", status: "filled" });
          }
        }
      });
      at(1200, { type: "interview.ended", interviewId: iv.interviewId, elapsed: iv.utterances.at(-1)!.t + 2 });
    });
  }

  at(1000, { type: "todos.updated", todos: todos(4, 4) });
  at(0, { type: "stage.changed", stage: "analyze" });
  at(300, { type: "analysis.started" });
  at(2200, { type: "todos.updated", todos: todos(5, 5) });
  at(0, { type: "stage.changed", stage: "report" });
  at(1600, { type: "report.ready", draft: approved ? 3 : 2 });
  at(0, { type: "todos.updated", todos: todos(6) });
  return out;
}
