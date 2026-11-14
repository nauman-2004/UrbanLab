"use client";

import { useStudy } from "@/lib/state/StudyProvider";
import { Card, CardHeader, Label } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { VarChip } from "../ui/Provenance";

/** Mirrors the Deep Agent's plan + `write_todos` state. */
export function ResearchPlan() {
  const { state } = useStudy();
  const { plan, todos } = state;
  const done = todos.filter((t) => t.status === "done").length;

  return (
    <Card className="h-full">
      <CardHeader icon="list" title="Research Plan" aside={todos.length ? `${done} / ${todos.length}` : undefined} />
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3.5 py-3">
        {!plan ? (
          <p className="text-[12.5px] leading-relaxed text-dim">The agent will draft a hypothesis, variables and a sampling plan here when the study starts.</p>
        ) : (
          <>
            <div className="mb-3 rounded-[10px] border border-accent/30 bg-accent/10 px-3 py-2.5 text-[12.5px]">
              <div className="mb-0.5 text-[9.5px] font-bold tracking-[0.09em] text-accent2">HYPOTHESIS</div>
              {plan.hypothesis}
            </div>
            <Label>Variables</Label>
            <div className="mb-3 flex flex-wrap gap-1">
              {plan.variables.map((v) => (
                <VarChip key={v.key} source={v.source}>
                  {v.label}
                </VarChip>
              ))}
            </div>
            <Label>Sample</Label>
            <p className="mb-3 text-xs text-soft">{plan.sample}</p>
          </>
        )}
        {todos.length > 0 && (
          <>
            <Label>Steps</Label>
            <ul className="flex flex-col gap-1">
              {todos.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-[12.5px] ${t.status === "running" ? "bg-accent/12 shadow-[inset_0_0_0_1px_#8b5cf666]" : ""}`}
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
                  <span className={t.status === "done" ? "text-muted" : t.status === "pending" ? "text-dim" : "font-semibold"}>
                    {t.label}
                    {t.detail && <span className="block text-[10.5px] font-medium text-accent2">{t.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
