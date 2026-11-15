"use client";

import { useEffect, useRef } from "react";
import { fmtCallTime, formatValue, parseSurveyEvidence } from "@/lib/format";
import { buildingName, cellKey } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import { Icon } from "../ui/Icon";
import { SelfReportedBadge, StubBadge, VarChip } from "../ui/Provenance";

const ts = (t: number) => fmtCallTime(t).padStart(5, "0");

/** One phone survey: consent, the approved questions, transcript, and what was extracted into the dataset. */
export function InterviewDrawer() {
  const { state, drawerCallId, openCall } = useStudy();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const call = drawerCallId ? state.calls[drawerCallId] : null;

  useEffect(() => {
    if (!call) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openCall(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call, openCall]);

  if (!call) return null;

  const approval = state.approvals.find((a) => a.kind === "survey" && a.args.building_id === call.building_id);
  const questions = Array.isArray(approval?.args.questions) ? (approval!.args.questions as string[]) : [];
  const surveyVars = (state.plan?.variables ?? []).filter((v) => v.source === "survey");
  const answers = surveyVars.map((v) => {
    const c = state.cells[cellKey(call.building_id, v.name)];
    return { v, c, ev: parseSurveyEvidence(c?.evidence_ref ?? null) };
  });
  const quotes = answers.map((a) => a.ev.quote).filter(Boolean) as string[];

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="iv-title">
      <button type="button" aria-label="Close transcript" onClick={() => openCall(null)} className="absolute inset-0 bg-[#050712]/60 backdrop-blur-[2px]" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[500px] flex-col border-l border-line2 bg-gradient-to-b from-[#151a39] to-[#0f1330] shadow-[-30px_0_60px_#000a]">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <span className="size-[30px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#7c3aed_60%,#3b1e8f)] shadow-[0_0_18px_#8b5cf688]" />
          <div className="flex-1">
            <h2 id="iv-title" className="text-base font-bold">Phone survey</h2>
            <div className="text-[11px] text-muted">
              field_surveyor subagent · call {state.callOrder.indexOf(call.call_id) + 1} of {state.callOrder.length} · <span className="font-mono">{call.call_id}</span>
            </div>
          </div>
          {call.stub && <StubBadge />}
          <span className="rounded-full border border-line2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">{fmtCallTime(call.duration_s)}</span>
          <button ref={closeBtn} type="button" onClick={() => openCall(null)} aria-label="Close transcript" className="grid size-8 place-items-center rounded-full bg-[#1d2246] text-muted hover:text-ink">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          <section className="border-b border-line px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#1d2246] text-accent2">
                <Icon name="building" className="size-5" />
              </div>
              <div className="min-w-0">
                <b className="text-sm">
                  {buildingName(state, call.building_id)} · {call.contact_role}
                </b>
                <div className="text-[11.5px] text-muted">
                  {call.building_id} · gaps: {surveyVars.map((v) => v.name).join(", ") || "—"}
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10.5px]">
              <span className="rounded-full border border-voice/30 bg-voice/10 px-2 py-0.5 text-[#a7f3d0]">✓ Approved by researcher</span>
              <span className={`rounded-full border px-2 py-0.5 ${call.consent ? "border-voice/30 bg-voice/10 text-[#a7f3d0]" : "border-gap/30 bg-gap/10 text-[#fecaca]"}`}>
                {call.consent ? "✓ Contact consented" : "✕ Contact declined"}
              </span>
              <span className="rounded-full border border-gap/30 bg-gap/10 px-2 py-0.5 text-[#fecaca]">● Recorded for research</span>
            </div>
            {call.stub && (
              <p className="mt-2 rounded-[9px] border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                Scripted stub transcript: telephony isn&apos;t connected yet (backend/telephony.py). Don&apos;t report these answers.
              </p>
            )}
          </section>

          {questions.length > 0 && (
            <section className="border-b border-line px-5 py-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Approved questions · {questions.length}</div>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-soft">
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </section>
          )}

          <section className="border-b border-line px-5 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Transcript</div>
            <ol className="flex flex-col gap-2 text-xs">
              {call.transcript.map((u, i) => {
                const hit = u.speaker === "contact" && quotes.includes(u.text);
                return (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={`w-14 shrink-0 rounded-md py-0.5 text-center text-[9.5px] font-bold ${u.speaker === "agent" ? "bg-accent/20 text-accent2" : "bg-voice/15 text-voice"}`}>
                      {u.speaker === "agent" ? "AI" : "Contact"}
                    </span>
                    <p className={`flex-1 ${hit ? "rounded-[3px] bg-voice/15 px-1 text-[#bbf7d0]" : "text-soft"}`}>{u.text}</p>
                    <time className="font-mono text-[10px] text-dim">{ts(u.t)}</time>
                  </li>
                );
              })}
              {call.transcript.length === 0 && <li className="text-dim">No transcript.</li>}
            </ol>
          </section>

          <section className="px-5 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Extracted into the dataset</span>
              {answers.some((a) => a.c?.status === "filled") && <SelfReportedBadge compact />}
            </div>
            <ul className="space-y-1.5">
              {answers.map(({ v, c, ev }) => (
                <li key={v.name} className="rounded-[10px] border border-line bg-well px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <VarChip source="survey">{v.name}</VarChip>
                    {c?.status === "filled" ? (
                      <b className="font-mono">{formatValue(c.value, v.type)}</b>
                    ) : (
                      <span className="font-semibold text-gap">MISSING</span>
                    )}
                  </div>
                  {c?.status === "filled" ? (
                    <div className="mt-1 text-[11px] text-muted">
                      conf {c.confidence?.toFixed(2) ?? "—"} · quote {ev.at ?? "—"}
                      {ev.quote && <span className="block italic">“{ev.quote}”</span>}
                    </div>
                  ) : (
                    c?.reason && <div className="mt-1 text-[11px] text-muted">{c.reason}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
