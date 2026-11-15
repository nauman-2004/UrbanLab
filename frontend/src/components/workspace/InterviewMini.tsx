"use client";

import { fmtCallTime } from "@/lib/format";
import { buildingName } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import { Icon } from "../ui/Icon";
import { StubBadge } from "../ui/Provenance";
import { Waveform } from "../ui/Waveform";

/** Latest phone survey. Expands into <InterviewDrawer/>. */
export function InterviewMini() {
  const { state, openCall } = useStudy();
  const id = state.callOrder.at(-1);
  const call = id ? state.calls[id] : null;
  const approved = state.approvals.filter((a) => a.kind === "survey" && a.status === "approved").length;
  if (!call) return null;

  const last = call.transcript.at(-1);
  const n = state.callOrder.length;

  return (
    <div className="shrink-0 border-t border-line bg-gradient-to-b from-voice/[0.03] to-voice/[0.08] px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="size-[30px] shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#7c3aed_60%,#3b1e8f)] shadow-[0_0_0_4px_#8b5cf622,0_0_18px_#8b5cf688]" />
        <div className="min-w-0 flex-1 leading-tight">
          <b className="text-[12.5px]">Phone survey</b>
          <div className="truncate text-[10.5px] text-muted">
            {buildingName(state, call.building_id)} · {call.contact_role} · {n} of {Math.max(approved, n)} calls
          </div>
        </div>
        {call.stub && <StubBadge />}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">
          {call.consent ? "ENDED" : "DECLINED"} {fmtCallTime(call.duration_s)}
        </span>
      </div>
      <Waveform bars={56} height={22} active={false} />
      {last && (
        <p className="my-2 line-clamp-2 rounded-[9px] border border-line bg-well px-2.5 py-1.5 text-[11.5px] text-soft">
          <span className="mr-1.5 text-[10px] font-semibold text-dim">{last.speaker === "agent" ? "AI" : "Contact"}</span>
          {last.text}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="mr-auto font-mono text-[10px] text-dim">{call.call_id}</span>
        <button
          type="button"
          onClick={() => openCall(call.call_id)}
          className="inline-flex items-center gap-1 rounded-lg border border-accent2/40 bg-accent/12 px-2.5 py-1 text-[11.5px] font-semibold text-accent2 hover:bg-accent/20"
        >
          Open transcript <Icon name="expand" className="size-3" />
        </button>
      </div>
    </div>
  );
}
