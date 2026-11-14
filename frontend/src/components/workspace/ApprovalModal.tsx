"use client";

import { useEffect, useRef } from "react";
import { useStudy } from "@/lib/state/StudyProvider";
import { Button } from "../ui/Card";
import { Icon } from "../ui/Icon";

/** Human-in-the-loop interrupt: the agent cannot call anyone without this approval. */
export function ApprovalModal() {
  const { state, status, respondApproval } = useStudy();
  const approveBtn = useRef<HTMLButtonElement>(null);
  const req = state.approval;
  const open = req?.status === "pending" && status === "awaiting";

  useEffect(() => {
    if (open) approveBtn.current?.focus();
  }, [open]);

  if (!open || !req) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#050712]/70 p-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="ap-title">
      <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-line2 bg-gradient-to-b from-[#181d3f] to-panel shadow-[0_30px_80px_#000c]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid size-10 place-items-center rounded-[11px] bg-unverified/15 text-unverified">
            <Icon name="shield" className="size-5" />
          </span>
          <div>
            <div className="text-[10.5px] font-semibold tracking-[0.08em] text-unverified">AGENT PAUSED · APPROVAL REQUIRED</div>
            <h2 id="ap-title" className="text-base font-bold">{req.title}</h2>
          </div>
        </div>
        <div className="space-y-4 px-5 py-4 text-[12.5px]">
          <p className="text-soft">{req.purpose}</p>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Who will be called</div>
            <ul className="divide-y divide-line rounded-[10px] border border-line bg-well">
              {req.targets.map((t) => (
                <li key={t.propertyId} className="flex items-center justify-between px-3 py-2">
                  <span className="font-medium">{state.rows[t.propertyId]?.info.name}</span>
                  <span className="text-muted">{t.contact} · contact from CoStar</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Script · 3 questions · about 1 minute</div>
            <ol className="list-decimal space-y-1 pl-5 text-soft">
              {req.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </div>
          <p className="rounded-[9px] border border-line bg-well px-3 py-2 text-[11.5px] text-muted">
            Each call opens by stating that it&apos;s an AI research assistant, asks for verbal consent, and is recorded. Answers enter the dataset as{" "}
            <b className="text-unverified">unverified</b> until independently confirmed.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="outline" onClick={() => respondApproval(false)}>
            Decline · keep gaps
          </Button>
          <button
            ref={approveBtn}
            type="button"
            onClick={() => respondApproval(true)}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_#7c3aed44] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent2"
          >
            Approve {req.targets.length} interviews <Icon name="arrowRight" className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
