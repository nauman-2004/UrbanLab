"use client";

import { useEffect, useRef } from "react";
import { useStudy } from "@/lib/state/StudyProvider";
import type { LogEntry } from "@/lib/types";
import { Card, CardHeader } from "../ui/Card";
import { InterviewMini } from "./InterviewMini";

const KIND_COLOR: Record<LogEntry["kind"], string> = {
  todo: "text-accent2",
  tool: "text-accent2",
  subagent: "text-accent2",
  gap: "text-gap",
  approval: "text-unverified",
  cell: "text-voice",
  analysis: "text-accent2",
  info: "text-muted",
};

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Live view of the Deep Agent: todos, tool calls, subagents, interrupts. */
export function AgentActivity() {
  const { state } = useStudy();
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [state.log.length]);

  return (
    <Card className="h-full">
      <CardHeader icon="sparkle" title="Agent Activity" aside={state.subagents ? `Deep Agent · ${state.subagents} subagent runs` : "Deep Agent"} />
      <ol ref={ref} aria-live="polite" className="scrollbar-thin flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-snug">
        {state.log.length === 0 && <li className="font-sans text-xs text-dim">Tool calls, subagents and approvals stream here.</li>}
        {state.log.map((e) => (
          <li key={e.id} className="flex gap-2">
            <time className="shrink-0 text-dim">{clock(e.at)}</time>
            <span className="min-w-0">
              <span className={KIND_COLOR[e.kind]}>{e.text}</span>
              {e.tag && <span className="ml-1 rounded border border-line2 px-1 text-[9.5px] text-muted">{e.tag}</span>}
              {e.detail && <span className="block text-muted">{e.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <InterviewMini />
    </Card>
  );
}
