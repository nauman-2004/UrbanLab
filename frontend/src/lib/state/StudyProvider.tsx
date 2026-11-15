"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { ApprovalDecision, StudyEvent } from "../events";
import { LiveSource } from "../source/live";
import type { SourceStatus, StudySource } from "../source/types";
import { initialState, studyReducer, type StudyState } from "./reducer";

export const DEFAULT_QUESTION = "Do older office buildings in Houston dedicate more land to surface parking?";

interface StudyContextValue {
  state: StudyState;
  status: SourceStatus;
  statusDetail: string | null;
  /** Study clock (ms), refreshed ~4×/s while running. */
  clock: number;
  selectedId: string | null;
  start(question: string): void;
  answer(decisions: ApprovalDecision[]): Promise<void>;
  resolveUrl(path: string | undefined): string | null;
  select(id: string | null): void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const StudyContext = createContext<StudyContextValue | null>(null);

export function StudyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(studyReducer, initialState);
  const [status, setStatus] = useState<SourceStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sourceRef = useRef<StudySource | null>(null);

  useEffect(() => {
    const listener = {
      onEvent: (event: StudyEvent, at: number) => dispatch({ type: "event", event, at }),
      onStatus: (s: SourceStatus, detail?: string) => {
        setStatus(s);
        setStatusDetail(detail ?? null);
        setClock(sourceRef.current?.now() ?? 0);
      },
    };
    sourceRef.current = new LiveSource(API_BASE, listener);
    return () => sourceRef.current?.stop();
  }, []);

  // Tick the clock while the study runs (timers, "just filled" highlights).
  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => setClock(sourceRef.current?.now() ?? 0), 250);
    return () => clearInterval(id);
  }, [status]);

  const start = useCallback((question: string) => {
    dispatch({ type: "reset", question });
    setSelectedId(null);
    sourceRef.current?.start(question);
  }, []);

  const answer = useCallback(async (decisions: ApprovalDecision[]) => {
    const at = sourceRef.current?.now() ?? 0;
    // Local-first: the modal closes immediately; the source tells the agent.
    for (const d of decisions) dispatch({ type: "answered", actionId: d.action_id, approved: d.approved, at });
    try {
      await sourceRef.current?.answer(decisions);
    } catch (err) {
      console.error("[UrbanLab] approval failed", err);
      setStatus("error");
      setStatusDetail("Could not send the approval to the agent backend.");
    }
  }, []);

  const resolveUrl = useCallback((path: string | undefined) => (path ? sourceRef.current?.resolveUrl(path) ?? null : null), []);

  const value = useMemo<StudyContextValue>(
    () => ({
      state,
      status,
      statusDetail,
      clock,
      selectedId,
      start,
      answer,
      resolveUrl,
      select: setSelectedId,
    }),
    [state, status, statusDetail, clock, selectedId, start, answer, resolveUrl],
  );

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useStudy(): StudyContextValue {
  const ctx = useContext(StudyContext);
  if (!ctx) throw new Error("useStudy must be used inside <StudyProvider>");
  return ctx;
}
