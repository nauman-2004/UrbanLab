"use client";

import type { ReactNode } from "react";
import type { VoiceResearchResult } from "../types";
import { CartesiaTag, Card, formatValue, MissingTag } from "./ui";

const STATUS: Record<VoiceResearchResult["status"], { label: string; cls: string }> = {
  complete: { label: "Complete", cls: "border-voice/40 bg-voice/10 text-voice" },
  partial: { label: "Partial", cls: "border-unverified/40 bg-unverified/10 text-unverified" },
  cancelled: { label: "Not collected", cls: "border-line2 bg-panel2 text-soft" },
  failed: { label: "Failed", cls: "border-gap/40 bg-gap/10 text-gap" },
};

/** Structured interview result for human review. Values stay null unless evidence was collected. */
export function EvidenceExtraction({ result, actions }: { result: VoiceResearchResult; actions?: ReactNode }) {
  const s = STATUS[result.status];
  const byId = new Map(result.evidence.map((e) => [e.evidenceId, e]));
  return (
    <Card title="Evidence extraction" right={<span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span>}>
      <div className="space-y-3 p-4">
        {result.extractor?.isMock && (
          <p className="rounded-md border border-unverified/40 bg-unverified/10 px-3 py-2 text-xs text-unverified">
            Mock extractor: hand-written annotations for the scripted demo transcript. Not AI, and it extracts nothing from real
            conversations. A Gemini or backend extractor plugs in behind the same interface.
          </p>
        )}
        {result.declined && <p className="text-sm text-soft">The participant declined to take part. Nothing was recorded.</p>}
        {result.error && <p className="rounded-md border border-gap/40 bg-gap/10 px-3 py-2 text-xs text-gap">{result.error.message}</p>}

        <ul className="divide-y divide-line rounded-lg border border-line bg-well">
          {result.fields.map((f) => {
            const ev = f.evidenceId ? byId.get(f.evidenceId) : undefined;
            return (
              <li key={f.key} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{f.label}</span>
                  {ev ? (
                    <span className="flex items-center gap-2">
                      <span className="unverified-ring rounded px-1.5 font-mono text-sm font-semibold">{formatValue(ev.value)}</span>
                      <CartesiaTag compact />
                    </span>
                  ) : (
                    <MissingTag label={f.status === "unknown" ? "Unknown" : "Missing"} />
                  )}
                </div>
                {ev ? (
                  <p className="mt-1 text-xs text-muted">
                    “{ev.quote}”{" "}
                    {typeof ev.confidence === "number" && <span className="font-mono text-dim">· conf {ev.confidence.toFixed(2)}</span>}
                  </p>
                ) : (
                  f.reason && <p className="mt-1 text-xs text-dim">{f.reason}</p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-dim">
          source = cartesia · method = interview · verification = unverified · session <span className="font-mono">{result.sessionId}</span>
        </p>
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    </Card>
  );
}
