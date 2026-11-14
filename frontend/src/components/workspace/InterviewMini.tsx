"use client";

import { useStudy } from "@/lib/state/StudyProvider";
import { Icon } from "../ui/Icon";
import { Waveform } from "../ui/Waveform";

export const fmtCall = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Collapsed Cartesia interview card. Expands into <InterviewDrawer/>. */
export function InterviewMini() {
  const { state, setDrawerOpen } = useStudy();
  const id = state.activeInterviewId ?? state.interviewOrder.at(-1);
  const iv = id ? state.interviews[id] : null;
  if (!iv) return null;

  const live = iv.status !== "ended";
  const row = state.rows[iv.propertyId];
  const asking = iv.questions.findIndex((q) => q.status === "asking");
  const answered = iv.questions.filter((q) => q.status === "answered").length;
  const last = iv.transcript.at(-1);
  const n = state.interviewOrder.indexOf(iv.id) + 1;

  return (
    <div className="shrink-0 border-t border-line bg-gradient-to-b from-voice/[0.03] to-voice/[0.08] px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="size-[30px] shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#7c3aed_60%,#3b1e8f)] shadow-[0_0_0_4px_#8b5cf622,0_0_18px_#8b5cf688]" />
        <div className="min-w-0 flex-1 leading-tight">
          <b className="text-[12.5px]">Voice interview</b>
          <div className="truncate text-[10.5px] text-muted">
            {row?.info.name} · {iv.contact} · {live ? `Q${Math.max(asking, answered - 1) + 1}/3` : `${n} of ${state.gaps.length || 3} done`}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${live ? "border-voice/40 bg-voice/10 text-voice" : "border-line2 text-muted"}`}
        >
          {live ? "● LIVE" : "ENDED"} {fmtCall(iv.elapsed)}
        </span>
      </div>
      <Waveform bars={56} height={22} active={live} />
      {last && (
        <p className="my-2 line-clamp-2 rounded-[9px] border border-line bg-well px-2.5 py-1.5 text-[11.5px] text-soft">
          <span className="mr-1.5 text-[10px] font-semibold text-dim">{last.speaker === "agent" ? "AI" : "Contact"}</span>
          {last.text}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="mr-auto text-[10px] text-dim">Voice by Cartesia</span>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-accent2/40 bg-accent/12 px-2.5 py-1 text-[11.5px] font-semibold text-accent2 hover:bg-accent/20"
        >
          Expand interview <Icon name="expand" className="size-3" />
        </button>
      </div>
    </div>
  );
}
