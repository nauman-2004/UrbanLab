"use client";

import { useEffect, useRef, useState } from "react";
import { buildingName, pendingRound } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Approval } from "@/lib/types";
import { Button } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { VarChip } from "../ui/Provenance";

/**
 * Human-in-the-loop interrupt (DeepAgents `interrupt_on`). The agent is paused
 * until every approval raised in this pause is answered.
 *   - plan:   approve, or reject with feedback (the planner revises and resubmits)
 *   - survey: approve or decline each phone call individually
 */
export function ApprovalModal() {
  const { state } = useStudy();
  const round = pendingRound(state);
  if (!round.length) return null;
  const plans = round.filter((a) => a.kind === "plan");
  const others = round.filter((a) => a.kind !== "plan");
  // One dialog at a time; plan approvals come first in practice.
  return plans.length ? <PlanApproval key={plans[0].action_id} ap={plans[0]} /> : <CallApproval key={others[0].action_id} round={others} />;
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
  hypothesis?: string;
  variables?: { name: string; source: string; type?: string }[];
  sample?: { city?: string; property_type?: string; n?: number };
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
        <Heading>Hypothesis</Heading>
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
        <p className="text-soft">
          {plan.sample?.n} {plan.sample?.property_type} properties in {plan.sample?.city}
        </p>
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

function CallApproval({ round }: { round: Approval[] }) {
  const { state, answer, sourceKind } = useStudy();
  // Track declines, not approvals: calls in a pause arrive one event at a time, and each new one starts approved.
  const [declined, setDeclined] = useState<Set<string>>(() => new Set());
  const approved = (id: string) => !declined.has(id);
  const submitBtn = useRef<HTMLButtonElement>(null);
  const yes = round.filter((a) => approved(a.action_id)).length;
  const canDecline = sourceKind === "live";

  useEffect(() => submitBtn.current?.focus(), []);

  return (
    <Shell
      kicker="AGENT PAUSED · APPROVAL REQUIRED"
      title={`Approve ${round.length} phone survey${round.length > 1 ? "s" : ""}`}
      footer={
        <>
          {!canDecline && <span className="mr-auto text-[11px] text-dim">Demo replay: declining works in live mode.</span>}
          {canDecline && (
            <Button variant="outline" onClick={() => answer(round.map((a) => ({ action_id: a.action_id, approved: false })))}>
              Decline all · keep gaps
            </Button>
          )}
          <button
            ref={submitBtn}
            type="button"
            onClick={() => answer(round.map((a) => ({ action_id: a.action_id, approved: approved(a.action_id) })))}
            className={primaryCls}
          >
            {yes === round.length ? `Approve ${yes} call${yes > 1 ? "s" : ""}` : `Approve ${yes} · decline ${round.length - yes}`} <Icon name="arrowRight" className="size-3.5" />
          </button>
        </>
      }
    >
      <p className="text-soft">{round[0].description || "Each is a phone call to a real person."}</p>
      <ul className="space-y-2">
        {round.map((a) => {
          const bid = String(a.args.building_id ?? "");
          const questions = Array.isArray(a.args.questions) ? (a.args.questions as string[]) : [];
          const on = approved(a.action_id);
          return (
            <li key={a.action_id} className={`rounded-[10px] border px-3 py-2.5 ${on ? "border-voice/35 bg-voice/[0.05]" : "border-line bg-well opacity-70"}`}>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!canDecline}
                  onChange={(e) =>
                    setDeclined((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.delete(a.action_id);
                      else next.add(a.action_id);
                      return next;
                    })
                  }
                  className="size-4 accent-[var(--color-voice)]"
                />
                <span className="font-medium">{buildingName(state, bid)}</span>
                <span className="ml-auto font-mono text-[10.5px] text-dim">
                  {bid} · property manager
                </span>
              </label>
              {questions.length > 0 && (
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-11 text-[12px] text-soft">
                  {questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      <p className="rounded-[9px] border border-line bg-well px-3 py-2 text-[11.5px] text-muted">
        Each call opens by stating that it&apos;s an automated research assistant, asks for consent, and is recorded. Answers enter the dataset as{" "}
        <b className="text-unverified">self-reported and unverified</b>. A declined call is never placed or retried; its values stay missing.
      </p>
    </Shell>
  );
}
