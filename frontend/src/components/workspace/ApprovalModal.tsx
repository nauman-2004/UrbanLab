"use client";

import { useEffect, useRef, useState } from "react";
import { pendingRound } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import { describeFilter, describeSample } from "@/lib/format";
import type { Approval, PlanSample } from "@/lib/types";
import { Button } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { VarChip } from "../ui/Provenance";

/**
 * Human-in-the-loop interrupt (DeepAgents `interrupt_on`). The agent is paused
 * until every approval raised in this pause is answered.
 *   - plan:  approve, or reject with feedback (the planner revises and resubmits)
 *   - other: approve or reject the gated tool call
 */
export function ApprovalModal() {
  const { state } = useStudy();
  const round = pendingRound(state);
  if (!round.length) return null;
  const plans = round.filter((a) => a.kind === "plan");
  const others = round.filter((a) => a.kind !== "plan");
  // One dialog at a time; plan approvals come first in practice.
  return plans.length ? <PlanApproval key={plans[0].action_id} ap={plans[0]} /> : <ToolApproval key={others[0].action_id} ap={others[0]} />;
}

function Shell({ title, kicker, children, footer }: { title: string; kicker: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#050712]/70 p-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="ap-title">
      <div className="flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-line2 bg-gradient-to-b from-[#181d3f] to-panel shadow-[0_30px_80px_#000c]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid size-10 place-items-center rounded-[11px] bg-unverified/15 text-unverified">
            <Icon name="shield" className="size-5" />
          </span>
          <div>
            <div className="text-[10.5px] font-semibold tracking-[0.08em] text-unverified">{kicker}</div>
            <h2 id="ap-title" className="text-base font-bold">{title}</h2>
          </div>
        </div>
        <div className="scrollbar-thin space-y-4 overflow-y-auto px-5 py-4 text-[12.5px]">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>
      </div>
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">{children}</div>;

const primaryCls =
  "inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_#7c3aed44] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent2 disabled:opacity-50";

interface PlanArgs {
  goal?: "compare" | "lookup";
  hypothesis?: string;
  variables?: { name: string; source: string; type?: string }[];
  sample?: Partial<PlanSample>;
}

function PlanApproval({ ap }: { ap: Approval }) {
  const { answer, sourceKind } = useStudy();
  const [feedback, setFeedback] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const approveBtn = useRef<HTMLButtonElement>(null);
  const plan = ap.args as PlanArgs;
  const canReject = ap.allowed_decisions.includes("reject") && sourceKind === "live";

  useEffect(() => approveBtn.current?.focus(), []);

  return (
    <Shell
      kicker="AGENT PAUSED · PLAN REVIEW"
      title="Approve the research plan"
      footer={
        rejecting ? (
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Back
            </Button>
            <Button variant="danger" onClick={() => answer([{ action_id: ap.action_id, approved: false, feedback: feedback.trim() || undefined }])}>
              Send back to planner
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => setRejecting(true)}
              disabled={!canReject}
              title={canReject ? undefined : "The recorded demo continues with the approved plan; rejecting works in live mode."}
            >
              Reject · revise
            </Button>
            <button ref={approveBtn} type="button" onClick={() => answer([{ action_id: ap.action_id, approved: true }])} className={primaryCls}>
              Approve plan <Icon name="arrowRight" className="size-3.5" />
            </button>
          </>
        )
      }
    >
      <p className="text-soft">{ap.description || "Review the research plan before any data is collected."}</p>
      <div>
        <Heading>{plan.goal === "lookup" ? "Lookup" : "Hypothesis"}</Heading>
        <p className="rounded-[10px] border border-accent/30 bg-accent/10 px-3 py-2">{plan.hypothesis ?? "—"}</p>
      </div>
      <div>
        <Heading>Variables · {plan.variables?.length ?? 0}</Heading>
        <div className="flex flex-wrap gap-1">
          {(plan.variables ?? []).map((v) => (
            <VarChip key={v.name} source={v.source} title={`${v.type ?? ""} · from ${v.source}`}>
              {v.name}
            </VarChip>
          ))}
        </div>
      </div>
      <div>
        <Heading>Sample</Heading>
        <p className="text-soft">{describeSample(plan.sample)}</p>
        {!!plan.sample?.filters?.length && (
          <>
            <Heading>Every property must meet</Heading>
            <ul className="space-y-0.5 font-mono text-[11.5px] text-soft">
              {plan.sample.filters.map((f) => (
                <li key={describeFilter(f)}>• {describeFilter(f)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {rejecting && (
        <div>
          <label htmlFor="fb" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">
            What should the planner change?
          </label>
          <textarea
            id="fb"
            autoFocus
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Use 12 buildings and drop surface_parking_pct."
            className="w-full rounded-[9px] border border-line2 bg-well px-3 py-2 text-[12.5px] outline-none focus:border-accent2"
          />
        </div>
      )}
    </Shell>
  );
}

function ToolApproval({ ap }: { ap: Approval }) {
  const { answer, sourceKind } = useStudy();
  const submitBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => submitBtn.current?.focus(), []);

  return (
    <Shell
      kicker="AGENT PAUSED · APPROVAL REQUIRED"
      title={`Approve ${ap.tool}`}
      footer={
        <>
          {sourceKind === "live" && (
            <Button variant="outline" onClick={() => answer([{ action_id: ap.action_id, approved: false }])}>
              Reject
            </Button>
          )}
          <button ref={submitBtn} type="button" onClick={() => answer([{ action_id: ap.action_id, approved: true }])} className={primaryCls}>
            Approve <Icon name="arrowRight" className="size-3.5" />
          </button>
        </>
      }
    >
      {ap.description && <p className="text-soft">{ap.description}</p>}
      <pre className="overflow-x-auto rounded-[9px] border border-line bg-well px-3 py-2 font-mono text-[11px] text-muted">{JSON.stringify(ap.args, null, 2)}</pre>
    </Shell>
  );
}
