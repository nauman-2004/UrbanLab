"use client";

import { useEffect, useRef } from "react";
import { fmtClock } from "@/lib/format";
import { useStudy } from "@/lib/state/StudyProvider";
import type { LogEntry } from "@/lib/types";
import { Card, CardHeader } from "../ui/Card";

const KIND_COLOR: Record<LogEntry["kind"], string> = {
  step: "text-accent2",
  tool: "text-soft",
  gap: "text-gap",
  approval: "text-unverified",
  cell: "text-voice",
  analysis: "text-accent2",
  info: "text-muted",
  error: "text-gap",
};

/** Live view of the Deep Agent: subagents, their tool calls, interrupts, values landing. */
export function AgentActivity() {
  const { state } = useStudy();
  const ref = useRef<HTMLOListElement>(null);
  const runs = state.steps.filter((s) => s.status !== "pending").length;

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [state.log.length]);

  return (
    <Card className="h-full">
      <CardHeader icon="sparkle" title="Agent Activity" aside={runs ? `Deep Agent · ${runs} subagents · ${state.toolCalls} tool calls` : "Deep Agent"} />
      <ol ref={ref} aria-live="polite" className="scrollbar-thin flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-snug">
        {state.log.length === 0 && <li className="font-sans text-xs text-dim">Subagents, tool calls and approvals stream here.</li>}
        {state.log.map((e) => (
          <li key={e.id} className="flex gap-2">
            <time className="shrink-0 text-dim">{fmtClock(e.at)}</time>
            <span className="min-w-0 break-words">
              <span className={KIND_COLOR[e.kind]}>{e.text}</span>
              {e.tag && <span className="ml-1 rounded border border-line2 px-1 text-[9.5px] text-muted">{e.tag}</span>}
              {e.detail && <span className="block text-muted">{e.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
