"use client";

import type { ResearchContext, VoiceMode } from "../types";
import { Card, ModeBadge } from "./ui";

/**
 * Human approval before any primary evidence is collected. Nothing connects
 * (no microphone, no Cartesia) until "Approve & Start".
 */
export function ApprovalGate({
  context,
  mode,
  onApprove,
  onCancel,
  notice,
}: {
  context: ResearchContext;
  mode: VoiceMode;
  onApprove: () => void;
  onCancel: () => void;
  notice?: string | null;
}) {
  return (
    <Card title="Primary evidence collection" right={<ModeBadge mode={mode} />}>
      <div className="space-y-4 p-4">
        <p className="text-sm text-soft">
          UrbanLab could not find this evidence in records, aerial imagery or 3D scans. Approve a short voice interview with the{" "}
          {(context.participantRole ?? "property manager").toLowerCase()} to collect it.
        </p>

        <dl className="grid grid-cols-[7.5rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Property</dt>
          <dd className="font-medium">
            {context.propertyName ?? context.propertyId} <span className="font-mono text-xs text-dim">{context.propertyId}</span>
          </dd>
          <dt className="text-muted">Study question</dt>
          <dd className="text-soft">{context.researchQuestion}</dd>
          <dt className="text-muted">Method</dt>
          <dd>
            Cartesia voice research{" "}
            {mode === "mock" && <span className="text-xs text-unverified">(mock: scripted, no call is made)</span>}
          </dd>
        </dl>

        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Missing evidence</h3>
          <ul className="divide-y divide-line rounded-lg border border-line bg-well">
            {context.missingEvidence.map((f) => (
              <li key={f.key} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {f.label}
                  {f.description && <span className="block text-xs text-dim">{f.description}</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase text-dim">{f.required ? "required" : "optional"}</span>
              </li>
            ))}
          </ul>
        </div>

        <ul className="space-y-1 text-xs text-muted">
          <li>• The microphone and the {mode === "live" ? "Cartesia connection" : "simulated session"} start only after you approve.</li>
          <li>• The participant is asked for consent first and may decline at any time.</li>
          <li>• Answers are recorded as self-reported and <span className="text-unverified">unverified</span>. Nothing is invented if they don&apos;t know.</li>
        </ul>

        {notice && <p className="rounded-md border border-unverified/40 bg-unverified/10 px-3 py-2 text-xs text-unverified">{notice}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line2 px-4 py-2 text-sm text-soft hover:bg-panel2">
            Cancel
          </button>
          <button type="button" onClick={onApprove} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent2">
            Approve &amp; Start
          </button>
        </div>
      </div>
    </Card>
  );
}
