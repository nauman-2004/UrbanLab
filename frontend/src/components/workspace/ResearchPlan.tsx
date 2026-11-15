"use client";

import { STEPS } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import { Card, CardHeader, Label } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { VarChip } from "../ui/Provenance";

const STEP_LABEL: Record<string, string> = {
  planner: "Plan the study",
  data_collector: "Pull CoStar records",
  vision_measurer: "Measure parking from aerials",
  gap_analyst: "Check coverage & gaps",
  analyst: "Analyze & report",
};

/** The approved plan + the orchestrator's progress through its subagents. */
export function ResearchPlan() {
  const { state } = useStudy();
  const { plan, steps } = state;
  const done = steps.filter((t) => t.status === "done").length;
  const started = state.studyId != null;

  return (
    <Card className="h-full">
      <CardHeader icon="list" title="Research Plan" aside={started ? `${done} / ${steps.length}` : undefined} />
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3.5 py-3">
        {!plan ? (
          <p className="mb-3 text-[12.5px] leading-relaxed text-dim">
            {started ? "The planner is drafting a hypothesis, variables and a sample. You'll be asked to approve it." : "The agent will draft a hypothesis, variables and a sampling plan here when the study starts."}
          </p>
        ) : (
          <>
            <div className="mb-3 rounded-[10px] border border-accent/30 bg-accent/10 px-3 py-2.5 text-[12.5px]">
              <div className="mb-0.5 text-[9.5px] font-bold tracking-[0.09em] text-accent2">HYPOTHESIS</div>
              {plan.hypothesis}
            </div>
            <Label>Variables</Label>
            <div className="mb-3 flex flex-wrap gap-1">
              {plan.variables.map((v) => (
                <VarChip key={v.name} source={v.source} title={`${v.label} · ${v.type} · from ${v.source}`}>
                  {v.name}
                </VarChip>
              ))}
            </div>
            <Label>Sample</Label>
            <p className="mb-3 text-xs text-soft">
              {plan.sample.n} {plan.sample.property_type} properties in {plan.sample.city} (CoStar)
            </p>
          </>
        )}
        {started && (
          <>
            <Label>Subagents</Label>
            <ul className="flex flex-col gap-1">
              {steps.map((t) => (
                <li
                  key={t.name}
                  className={`flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-[12.5px] ${t.status === "running" ? "bg-accent/12 shadow-[inset_0_0_0_1px_#8b5cf666]" : ""}`}
                  title={t.summary ?? t.description}
                >
                  <span
                    className={`grid size-[18px] shrink-0 place-items-center rounded-full border-2 ${
                      t.status === "done"
                        ? "border-voice bg-voice text-[#0b0f1e]"
                        : t.status === "running"
                          ? "animate-spin border-accent2 border-r-transparent"
                          : "border-line2"
                    }`}
                  >
                    {t.status === "done" && <Icon name="check" className="size-2.5" strokeWidth={3.5} />}
                  </span>
                  <span className={`min-w-0 ${t.status === "done" ? "text-muted" : t.status === "pending" ? "text-dim" : "font-semibold"}`}>
                    {STEP_LABEL[t.name] ?? t.name}
                    <span className="block font-mono text-[10px] font-normal text-dim">{t.name}</span>
                  </span>
                </li>
              ))}
            </ul>
            {STEPS.length < steps.length && <p className="mt-2 text-[10.5px] text-dim">The orchestrator also ran extra subagents.</p>}
          </>
        )}
      </div>
    </Card>
  );
}
