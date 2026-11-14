"use client";

import { useStudy } from "@/lib/state/StudyProvider";

const INTEGRATIONS = ["CoStar API", "Vexcel imagery", "Matterport", "LangChain Deep Agents", "LLM: Gemini ⇄ Nemotron", "Cartesia voice"];

/** Shows which integrations are live vs. replayed. In demo mode every value is synthetic. */
export function IntegrationBar() {
  const { sourceKind } = useStudy();
  const live = sourceKind === "live";
  return (
    <footer className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line bg-rail px-5 py-2 text-[10.5px] text-dim">
      <b className="font-semibold text-muted">Integrations</b>
      {INTEGRATIONS.map((n) => (
        <span key={n} className="inline-flex items-center gap-1.5">
          <i className={`size-1.5 rounded-full ${live ? "bg-voice" : "bg-amber-500"}`} />
          {n}
        </span>
      ))}
      <span className="ml-auto">
        {live ? (
          "● live agent stream"
        ) : (
          <>
            ● demo mode · <span className="text-unverified">synthetic data</span> · deterministic replay
          </>
        )}
      </span>
    </footer>
  );
}
