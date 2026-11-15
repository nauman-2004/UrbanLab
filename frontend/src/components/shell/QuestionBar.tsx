"use client";

import { useState } from "react";
import { STEPS, currentStepIndex } from "@/lib/state/reducer";
import { DEFAULT_QUESTION, useStudy } from "@/lib/state/StudyProvider";
import { Icon } from "../ui/Icon";

export function QuestionBar() {
  const { state, status, statusDetail, start, sourceKind } = useStudy();
  const [draft, setDraft] = useState(DEFAULT_QUESTION);
  const running = status === "connecting" || status === "playing" || status === "paused" || status === "awaiting";
  const current = currentStepIndex(state);
  const started = state.studyId != null;
  // Replay mode plays one recorded study, so its question is fixed.
  const editable = sourceKind === "live" && !running;
  const question = started ? state.question : draft;

  const run = () => {
    const q = (sourceKind === "live" ? draft : question).trim();
    if (q.length >= 5) start(q);
  };

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line2 bg-gradient-to-r from-[#171b3b] to-panel px-4 py-3 lg:flex-row lg:items-center">
      <form
        className="flex min-w-0 flex-1 items-center gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent/15 text-accent2">
          <Icon name="target" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="rq" className="text-[11px] font-medium text-muted">
            Research question{sourceKind === "replay" && " · recorded demo run"}
          </label>
          {editable ? (
            <input
              id="rq"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-line2 bg-well px-2 py-1 text-[15px] font-semibold leading-snug outline-none focus:border-accent2"
            />
          ) : (
            <div id="rq" className="text-[15px] font-semibold leading-snug">
              {sourceKind === "replay" && !started ? "Recorded study · press Run to replay" : question}
            </div>
          )}
          {status === "error" && statusDetail && <p className="mt-1 text-[11.5px] text-gap">{statusDetail}</p>}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <ol className="flex items-center" aria-label="Study progress">
          {STEPS.map((s, i) => {
            const st = state.steps.find((x) => x.name === s.name)?.status ?? "pending";
            const done = st === "done" || (state.finished && !state.error);
            const cur = started && !done && i === current;
            return (
              <li key={s.name} className="flex items-center">
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
        <Controls running={running} onRun={run} />
      </div>
    </div>
  );
}

function Controls({ running, onRun }: { running: boolean; onRun: () => void }) {
  const { status, togglePause, speed, setSpeed, sourceKind } = useStudy();

  if (!running)
    return (
      <div className="flex items-center gap-1.5">
        {(status === "done" || status === "error") && <StatusPill status={status} />}
        <button
          type="button"
          onClick={onRun}
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_#7c3aed44] hover:brightness-110"
        >
          <Icon name={status === "idle" ? "play" : "restart"} className="size-3" /> {status === "idle" ? "Run study" : "Run again"}
        </button>
      </div>
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
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    connecting: ["Connecting", "text-muted border-line2"],
    playing: ["Running", "text-voice border-voice/40 bg-voice/10"],
    paused: ["Paused", "text-muted border-line2"],
    awaiting: ["Awaiting approval", "text-unverified border-unverified/40 bg-unverified/10"],
    done: ["Complete", "text-accent2 border-accent2/40 bg-accent/10"],
    error: ["Failed", "text-gap border-gap/40 bg-gap/10"],
  };
  const [label, cls] = map[status] ?? ["", ""];
  if (!label) return null;
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${cls}`}>● {label}</span>;
}
