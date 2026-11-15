"use client";

import { useStudy } from "@/lib/state/StudyProvider";

const COSTAR_LABEL: Record<string, string | undefined> = { kit: undefined, synthetic: "synthetic test kit", sample: "sample CSV" };

/** What powers each part of the study. `stub` = placeholder data / integration in the backend today. */
export function IntegrationBar() {
  const { state } = useStudy();
  // CoStar's source is known once the first building arrives (kit, synthetic test kit or sample CSV).
  const first = state.order.length ? state.buildings[state.order[0]] : undefined;
  const costarStub = first ? COSTAR_LABEL[first.costar_source ?? "sample"] : "kit, or sample CSV if not configured";
  // Live Vexcel tiles are served from /tiles/live/; anything else is a local placeholder tile.
  const tiles = state.order.map((id) => state.buildings[id].aerial_url).filter(Boolean);
  const vexcelStub = tiles.length && tiles.every((u) => u!.startsWith("/tiles/live/")) ? undefined : tiles.length ? "placeholder tiles" : "live if VEXCEL_API_KEY is set";
  const integrations: { name: string; stub?: string }[] = [
    { name: "LangChain Deep Agents" },
    { name: "Google Gemini" },
    { name: "CoStar data kit", stub: costarStub },
    { name: "Vexcel imagery", stub: vexcelStub },
  ];
  return (
    <footer className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line bg-rail px-5 py-2 text-[10.5px] text-dim">
      <b className="font-semibold text-muted">Integrations</b>
      {integrations.map((n) => (
        <span key={n.name} className="inline-flex items-center gap-1.5" title={n.stub ? `Placeholder in the backend: ${n.stub}` : undefined}>
          <i className={`size-1.5 rounded-full ${n.stub ? "bg-amber-500" : "bg-voice"}`} />
          {n.name}
          {n.stub && <span className="text-amber-500/80">({n.stub})</span>}
        </span>
      ))}
      <span className="ml-auto">● live agent backend</span>
    </footer>
  );
}
