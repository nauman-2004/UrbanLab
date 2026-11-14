"use client";

import { useEffect, useRef, useState } from "react";
import { useStudy } from "@/lib/state/StudyProvider";
import { Icon } from "../ui/Icon";
import { VarChip } from "../ui/Provenance";
import { Waveform } from "../ui/Waveform";
import { fmtCall } from "./InterviewMini";
import { VerifyControl } from "./VerifyControl";

const ts = (t: number) => `00:${String(t).padStart(2, "0")}`;

function Highlighted({ text, mark }: { text: string; mark?: string }) {
  if (!mark || !text.includes(mark)) return <>{text}</>;
  const [a, b] = text.split(mark);
  return (
    <>
      {a}
      <mark className="rounded-[3px] bg-voice/20 px-0.5 text-[#bbf7d0]">{mark}</mark>
      {b}
    </>
  );
}

/** Expanded Cartesia interview panel: consent, progress, transcript, extraction, controls. */
export function InterviewDrawer() {
  const { state, drawerOpen, setDrawerOpen, sourceKind, hangup } = useStudy();
  const [muted, setMuted] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  const id = state.activeInterviewId ?? state.interviewOrder.at(-1);
  const iv = id ? state.interviews[id] : null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [iv?.transcript.length]);

  useEffect(() => {
    if (!drawerOpen) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen || !iv) return null;

  const row = state.rows[iv.propertyId];
  const live = iv.status !== "ended";
  const cell = iv.extracted ? row?.cells[iv.extracted.variable] : undefined;
  const answered = iv.questions.filter((q) => q.status === "answered").length;
  const speaking = iv.transcript.at(-1)?.speaker === "agent";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="iv-title">
      <button type="button" aria-label="Close interview" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-[#050712]/60 backdrop-blur-[2px]" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[500px] flex-col border-l border-line2 bg-gradient-to-b from-[#151a39] to-[#0f1330] shadow-[-30px_0_60px_#000a]">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <span className="size-[30px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#7c3aed_60%,#3b1e8f)] shadow-[0_0_18px_#8b5cf688]" />
          <div className="flex-1">
            <h2 id="iv-title" className="text-base font-bold">Field Interview</h2>
            <div className="text-[11px] text-muted">
              field-interviewer subagent · interview {state.interviewOrder.indexOf(iv.id) + 1} of {state.approval?.targets.length ?? 3}
            </div>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${live ? "border-voice/40 bg-voice/10 text-voice" : "border-line2 text-muted"}`}>
            {live ? "● LIVE" : "ENDED"} {fmtCall(iv.elapsed)}
          </span>
          <button ref={closeBtn} type="button" onClick={() => setDrawerOpen(false)} aria-label="Minimize interview" className="grid size-8 place-items-center rounded-full bg-[#1d2246] text-muted hover:text-ink">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>

        <div ref={scroller} className="scrollbar-thin flex-1 overflow-y-auto">
          <section className="border-b border-line px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#1d2246] text-accent2">
                <Icon name="building" className="size-5" />
              </div>
              <div className="min-w-0">
                <b className="text-sm">
                  {row?.info.name} · {iv.contact}
                </b>
                <div className="text-[11.5px] text-muted">
                  Contact from CoStar #{row?.info.costarId} · gap: <span className="font-mono text-gap">offsite_spaces</span>
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10.5px]">
              <span className="rounded-full border border-voice/30 bg-voice/10 px-2 py-0.5 text-[#a7f3d0]">✓ Approved by researcher</span>
              <span className={`rounded-full border px-2 py-0.5 ${iv.consent.verbalAt != null ? "border-voice/30 bg-voice/10 text-[#a7f3d0]" : "border-line2 text-muted"}`}>
                {iv.consent.verbalAt != null ? `✓ Verbal consent · ${ts(iv.consent.verbalAt)}` : "… awaiting verbal consent"}
              </span>
              {iv.consent.recording && <span className="rounded-full border border-gap/30 bg-gap/10 px-2 py-0.5 text-[#fecaca]">● Recording for research</span>}
            </div>
          </section>

          <section className="flex flex-col items-center border-b border-line px-5 py-3">
            <span className={`relative grid size-14 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#ddd6fe,#8b5cf6_55%,#3b1e8f)] shadow-[0_0_0_10px_#8b5cf61a,0_0_40px_#8b5cf6aa]`}>
              {live && speaking && <span className="absolute inset-0 animate-pulse-ring rounded-full border border-accent2" />}
              <Icon name="wave" className="size-6 text-white" />
            </span>
            <div className="mt-2 text-[13px] font-semibold">
              UrbanLab Research Agent <span className="font-medium text-dim">· {live ? (speaking ? "speaking" : "listening") : "call ended"}</span>
            </div>
            <div className="mt-2">
              <Waveform bars={70} height={30} active={live && !muted} />
            </div>
          </section>

          <section className="border-b border-line px-5 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Interview progress · {answered} / {iv.questions.length}</div>
            <ol className="flex flex-col gap-1.5">
              {iv.questions.map((q, i) => (
                <li
                  key={i}
                  className={`flex gap-2.5 rounded-[9px] border px-2.5 py-2 text-xs ${q.status === "asking" ? "border-accent2/50 bg-accent/10" : "border-line bg-well"}`}
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full border-2 text-[10px] font-bold ${
                      q.status === "answered" ? "border-voice bg-voice text-[#0b0f1e]" : q.status === "asking" ? "border-accent2 text-accent2" : "border-line2 text-muted"
                    }`}
                  >
                    {q.status === "answered" ? "✓" : i + 1}
                  </span>
                  <div className={q.status === "pending" ? "text-muted" : ""}>
                    {q.text}
                    {q.answer && (
                      <div className="mt-1">
                        <VarChip source={q.maps === "context" ? "derived" : "interview"}>{q.maps === "context" ? `context · ${q.answer}` : `offsite_spaces · ${q.answer}`}</VarChip>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="border-b border-line px-5 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim">Live transcript</div>
            <ol className="flex flex-col gap-2 text-xs" aria-live="polite">
              {iv.transcript.map((u, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className={`w-14 shrink-0 rounded-md py-0.5 text-center text-[9.5px] font-bold ${u.speaker === "agent" ? "bg-accent/20 text-accent2" : "bg-voice/15 text-voice"}`}>
                    {u.speaker === "agent" ? "AI" : "Contact"}
                  </span>
                  <p className="flex-1 text-soft">
                    <Highlighted text={u.text} mark={u.highlight} />
                  </p>
                  <time className="font-mono text-[10px] text-dim">{ts(u.t)}</time>
                </li>
              ))}
              {live && <li className="pl-16 text-dim">•••</li>}
            </ol>
          </section>

          {iv.extracted && (
            <section className="px-5 py-3">
              <div className="rounded-[10px] border border-voice/35 bg-voice/[0.06] px-3 py-2.5 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="mr-1 font-bold text-voice">↳</span>
                    Extracted by Gemini: <b className="font-mono">offsite_spaces = {iv.extracted.value.toLocaleString("en-US")}</b>
                    <div className="mt-0.5 text-muted">
                      conf {iv.extracted.confidence.toFixed(2)} · quote {ts(iv.extracted.quoteT)} · written to dataset
                    </div>
                  </div>
                  {cell && <VerifyControl propertyId={iv.propertyId} variable={iv.extracted.variable} cell={cell} />}
                </div>
                {cell?.verification === "unverified" && (
                  <p className="mt-2 text-[11px] text-unverified/90">Self-reported. Findings flag this value and report results with and without it until it is independently confirmed.</p>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-center gap-4 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-pressed={muted}
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            className="grid size-11 place-items-center rounded-full bg-[#1d2246] text-muted hover:text-ink"
          >
            <Icon name={muted ? "micOff" : "mic"} className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => hangup(iv.id)}
            disabled={!live || sourceKind === "replay"}
            title={sourceKind === "replay" ? "Hang-up is available in live mode" : "End call"}
            aria-label="End call"
            className="grid size-14 place-items-center rounded-full bg-red-500 text-white shadow-[0_8px_20px_#ef444466] disabled:opacity-50"
          >
            <Icon name="phoneOff" className="size-5" />
          </button>
          <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Minimize interview" className="grid size-11 place-items-center rounded-full bg-[#1d2246] text-muted hover:text-ink">
            <Icon name="expand" className="size-[18px] rotate-180" />
          </button>
          <span className="absolute right-5 bottom-4 hidden text-[10px] text-dim sm:block">Voice by Cartesia</span>
        </div>
      </aside>
    </div>
  );
}
