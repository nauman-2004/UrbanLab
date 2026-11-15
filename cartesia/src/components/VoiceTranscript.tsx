"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../types";
import { mmss } from "./ui";

/** Interview transcript: interviewer vs participant turns with call-relative timestamps. */
export function VoiceTranscript({
  entries,
  participantLabel = "Participant",
  highlightIds = [],
  emptyText = "The transcript appears here once the conversation starts.",
}: {
  entries: TranscriptEntry[];
  participantLabel?: string;
  /** Entries that produced evidence (outlined). */
  highlightIds?: string[];
  emptyText?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = entries.length;
  const lastLen = entries[count - 1]?.text.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [count, lastLen]);

  if (!count) return <p className="px-1 py-6 text-center text-sm text-dim">{emptyText}</p>;

  return (
    <ol className="space-y-3" aria-live="polite">
      {entries.map((e) => {
        const agent = e.role === "agent";
        return (
          <li key={e.id} data-role={e.role} className="grid grid-cols-[3rem_1fr] gap-2">
            <span className="pt-0.5 font-mono text-[10px] text-dim">{mmss(e.offsetSeconds)}</span>
            <div>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${agent ? "text-accent2" : "text-voice"}`}>
                {agent ? "UrbanLab interviewer" : participantLabel}
                {e.interrupted && <span className="ml-1.5 font-normal normal-case text-dim">(interrupted)</span>}
              </div>
              <p
                className={`mt-0.5 rounded-md text-sm leading-relaxed ${agent ? "text-soft" : "text-ink"} ${
                  highlightIds.includes(e.id) ? "-mx-1.5 bg-voice/10 px-1.5 py-0.5 ring-1 ring-voice/40" : ""
                }`}
              >
                {e.text}
                {!e.final && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-blink bg-muted" aria-hidden />}
              </p>
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
