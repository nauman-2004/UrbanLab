"use client";

import { useStudy } from "@/lib/state/StudyProvider";

/** What powers each part of the study. `stub` = placeholder integration in the backend today. */
const INTEGRATIONS: { name: string; stub?: string }[] = [
  { name: "LangChain Deep Agents" },
  { name: "OpenRouter · Nemotron" },
  { name: "CoStar", stub: "sample CSV" },
  { name: "Vexcel imagery", stub: "placeholder tiles" },
  { name: "Phone survey", stub: "scripted transcript" },
];

export function IntegrationBar() {
  const { sourceKind } = useStudy();
  const live = sourceKind === "live";
  return (
    <footer className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line bg-rail px-5 py-2 text-[10.5px] text-dim">
      <b className="font-semibold text-muted">Integrations</b>
      {INTEGRATIONS.map((n) => (
        <span key={n.name} className="inline-flex items-center gap-1.5" title={n.stub ? `Stub in the backend: ${n.stub}` : undefined}>
          <i className={`size-1.5 rounded-full ${n.stub ? "bg-amber-500" : live ? "bg-voice" : "bg-derived"}`} />
          {n.name}
          {n.stub && <span className="text-amber-500/80">({n.stub})</span>}
        </span>
      ))}
      <span className="ml-auto">{live ? "● live agent backend" : "● demo · replaying a recorded backend run"}</span>
    </footer>
  );
}
