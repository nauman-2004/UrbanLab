"use client";

import { STUDY } from "@/lib/data/houston";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Stage } from "@/lib/types";
import { Icon } from "../ui/Icon";

const STAGES: { id: Stage; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "collect", label: "Collect" },
  { id: "measure", label: "Measure" },
  { id: "fill", label: "Fill gaps" },
  { id: "analyze", label: "Analyze" },
  { id: "report", label: "Report" },
];

export function QuestionBar() {
  const { state, status } = useStudy();
  const current = STAGES.findIndex((s) => s.id === state.stage);
  const finished = state.reportDraft != null;
  const started = state.studyId != null;

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line2 bg-gradient-to-r from-[#171b3b] to-panel px-4 py-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent/15 text-accent2">
          <Icon name="target" className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-muted">Research question</div>
          <div className="text-[15px] font-semibold leading-snug">{state.question || STUDY.question}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ol className="flex items-center" aria-label="Study progress">
          {STAGES.map((s, i) => {
            const done = started && (finished || i < current);
            const cur = started && !finished && i === current;
            return (
              <li key={s.id} className="flex items-center">
                {i > 0 && <span className={`mb-[18px] h-0.5 w-3 sm:w-5 ${done || cur ? "bg-accent" : "bg-line2"}`} />}
                <div className="flex w-12 flex-col items-center gap-1 sm:w-16" aria-current={cur ? "step" : undefined}>
                  <span
                    className={`grid size-[22px] place-items-center rounded-full border-2 text-[11px] text-white ${
                      done ? "border-accent bg-accent" : cur ? "border-accent2 shadow-[0_0_0_4px_#8b5cf633]" : "border-line2"
                    }`}
                  >
                    {done ? <Icon name="check" className="size-3" /> : cur ? <span className="size-2 rounded-full bg-accent2" /> : null}
                  </span>
                  <span className={`text-[10.5px] font-medium ${cur ? "font-semibold text-ink" : done ? "text-muted" : "text-dim"}`}>{s.label}</span>
                </div>
              </li>
            );
          })}
        </ol>
        <ReplayControls status={status} />
      </div>
    </div>
  );
}

function ReplayControls({ status }: { status: string }) {
  const { start, togglePause, speed, setSpeed, sourceKind } = useStudy();

  if (status === "idle")
    return (
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_#7c3aed44] hover:brightness-110"
      >
        <Icon name="play" className="size-3" /> Run study
      </button>
    );

  if (sourceKind === "live") return <StatusPill status={status} />;

  return (
    <div className="flex items-center gap-1.5">
      <StatusPill status={status} />
      {(status === "playing" || status === "paused") && (
        <button
          type="button"
          onClick={togglePause}
          aria-label={status === "playing" ? "Pause replay" : "Resume replay"}
          className="grid size-8 place-items-center rounded-lg border border-line2 text-muted hover:text-ink"
        >
          <Icon name={status === "playing" ? "pause" : "play"} className="size-3" />
        </button>
      )}
      <div className="flex rounded-lg border border-line2 p-0.5" role="group" aria-label="Replay speed">
        {[1, 2, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSpeed(n)}
            aria-pressed={speed === n}
            className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${speed === n ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
          >
            {n}×
          </button>
        ))}
      </div>
      {status === "done" && (
        <button type="button" onClick={start} aria-label="Replay study" className="grid size-8 place-items-center rounded-lg border border-line2 text-muted hover:text-ink">
          <Icon name="restart" className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    playing: ["Running", "text-voice border-voice/40 bg-voice/10"],
    paused: ["Paused", "text-muted border-line2"],
    awaiting: ["Awaiting approval", "text-unverified border-unverified/40 bg-unverified/10"],
    done: ["Complete", "text-accent2 border-accent2/40 bg-accent/10"],
    error: ["Connection error", "text-gap border-gap/40 bg-gap/10"],
  };
  const [label, cls] = map[status] ?? ["", ""];
  if (!label) return null;
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${cls}`}>● {label}</span>;
}
