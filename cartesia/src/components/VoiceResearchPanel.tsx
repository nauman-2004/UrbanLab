"use client";

import { useEffect, useState } from "react";
import type { CartesiaVoice } from "../hooks/useCartesiaVoice";
import type { ResearchContext, VoiceSessionStatus } from "../types";
import { Card, ModeBadge, mmss, Waveform } from "./ui";
import { VoiceTranscript } from "./VoiceTranscript";

const STATUS_TEXT: Partial<Record<VoiceSessionStatus, string>> = {
  requesting_microphone: "Requesting microphone…",
  connecting: "Connecting to Cartesia…",
  live: "Interview in progress",
  ending: "Ending session…",
  extracting: "Extracting evidence from transcript…",
};

function useElapsed(startedAt: string | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  return startedAt ? (now - Date.parse(startedAt)) / 1000 : 0;
}

/** Live research-interview panel (not a chatbot): status, audio activity, timer, transcript, controls. */
export function VoiceResearchPanel({ voice, context }: { voice: CartesiaVoice; context: ResearchContext }) {
  const { state } = voice;
  const live = state.status === "live";
  const elapsed = useElapsed(state.startedAt, live);
  const connecting = state.status === "requesting_microphone" || state.status === "connecting";

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Primary evidence <span className="font-normal normal-case tracking-normal text-dim">· Powered by Cartesia</span>
        </span>
      }
      right={<ModeBadge mode={state.mode} />}
    >
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">{context.propertyName ?? context.propertyId}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span
                className={`size-2 rounded-full ${live ? "bg-voice" : connecting ? "animate-pulse bg-unverified" : "bg-dim"}`}
                aria-hidden
              />
              <span role="status">{STATUS_TEXT[state.status] ?? state.status}</span>
              {state.isMuted && live && <span className="text-unverified">· Microphone muted</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg tabular-nums">{mmss(elapsed)}</div>
            <div className="text-[10px] uppercase tracking-wider text-dim">elapsed</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-accent2">Interviewer {state.isAgentSpeaking && "· speaking"}</div>
            <Waveform level={state.outputLevel} active={live && state.isAgentSpeaking} tone="accent" />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-voice">{context.participantRole ?? "Participant"}</div>
            <Waveform level={state.inputLevel} active={live && !state.isMuted} />
          </div>
        </div>
      </div>

      <div className="scrollbar-thin max-h-[22rem] min-h-[12rem] overflow-y-auto px-4 py-3">
        <VoiceTranscript
          entries={state.transcript}
          participantLabel={context.participantRole ?? "Participant"}
          emptyText={connecting ? "Waiting for the session…" : undefined}
        />
      </div>

      {state.error && state.error.kind !== "approval_required" && (
        <p className="mx-4 mb-3 rounded-md border border-gap/40 bg-gap/10 px-3 py-2 text-xs text-gap" role="alert">
          {state.error.message}
        </p>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <span className="text-xs text-dim">Answers are self-reported and unverified.</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!live}
            onClick={() => (state.isMuted ? voice.unmute() : voice.mute())}
            className="rounded-lg border border-line2 px-3 py-1.5 text-sm text-soft hover:bg-panel2 disabled:opacity-40"
          >
            {state.isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            disabled={!(live || connecting)}
            onClick={() => void voice.endSession()}
            className="rounded-lg bg-gap/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gap disabled:opacity-40"
          >
            End research
          </button>
        </div>
      </footer>
    </Card>
  );
}
