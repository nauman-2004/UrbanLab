"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { STUDY } from "../data/houston";
import { LiveSource } from "../source/live";
import { ReplaySource } from "../source/replay";
import type { SourceStatus, StudySource } from "../source/types";
import type { StudyEvent } from "../events";
import type { VariableKey } from "../types";
import { initialState, studyReducer, type StudyState } from "./reducer";

interface StudyContextValue {
  state: StudyState;
  status: SourceStatus;
  sourceKind: "replay" | "live";
  speed: number;
  /** Study clock (ms), refreshed ~4×/s while running. */
  clock: number;
  selectedId: string | null;
  drawerOpen: boolean;
  start(): void;
  togglePause(): void;
  setSpeed(n: number): void;
  respondApproval(approved: boolean): void;
  verify(propertyId: string, variable: VariableKey, evidenceRef: string): void;
  hangup(interviewId: string): void;
  select(id: string | null): void;
  setDrawerOpen(open: boolean): void;
}

const SOURCE_KIND: "replay" | "live" = process.env.NEXT_PUBLIC_STUDY_SOURCE === "live" ? "live" : "replay";

const StudyContext = createContext<StudyContextValue | null>(null);

export function StudyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(studyReducer, initialState);
  const [status, setStatus] = useState<SourceStatus>("idle");
  const [speed, setSpeedState] = useState(1);
  const [clock, setClock] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sourceRef = useRef<StudySource | null>(null);

  useEffect(() => {
    const listener = {
      onEvent: (event: StudyEvent, at: number) => dispatch({ type: "event", event, at }),
      onStatus: (s: SourceStatus) => {
        setStatus(s);
        setClock(sourceRef.current?.now() ?? 0);
      },
    };
    sourceRef.current = SOURCE_KIND === "live"
      ? new LiveSource(process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000", listener)
      : new ReplaySource(listener);
    return () => sourceRef.current?.stop();
  }, []);

  // Tick the clock while the study runs (timers, "just filled" highlights).
  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => setClock(sourceRef.current?.now() ?? 0), 250);
    return () => clearInterval(id);
  }, [status]);

  const start = useCallback(() => {
    dispatch({ type: "reset" });
    setSelectedId(null);
    setDrawerOpen(false);
    sourceRef.current?.start(STUDY.question);
  }, []);

  const togglePause = useCallback(() => {
    const s = sourceRef.current;
    if (!s) return;
    if (status === "playing") s.pause();
    else if (status === "paused") s.resume();
  }, [status]);

  const setSpeed = useCallback((n: number) => {
    setSpeedState(n);
    sourceRef.current?.setSpeed(n);
  }, []);

  const respondApproval = useCallback(
    (approved: boolean) => {
      const at = sourceRef.current?.now() ?? 0;
      dispatch({ type: "approval", approved, at });
      sourceRef.current?.send({ type: "approval.respond", requestId: state.approval?.id ?? "", approved });
    },
    [state.approval?.id],
  );

  const verify = useCallback((propertyId: string, variable: VariableKey, evidenceRef: string) => {
    sourceRef.current?.send({ type: "cell.verify", propertyId, variable, evidenceRef });
  }, []);

  const hangup = useCallback((interviewId: string) => {
    sourceRef.current?.send({ type: "interview.hangup", interviewId });
  }, []);

  const value = useMemo<StudyContextValue>(
    () => ({
      state,
      status,
      sourceKind: SOURCE_KIND,
      speed,
      clock,
      selectedId,
      drawerOpen,
      start,
      togglePause,
      setSpeed,
      respondApproval,
      verify,
      hangup,
      select: setSelectedId,
      setDrawerOpen,
    }),
    [state, status, speed, clock, selectedId, drawerOpen, start, togglePause, setSpeed, respondApproval, verify, hangup],
  );

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useStudy(): StudyContextValue {
  const ctx = useContext(StudyContext);
  if (!ctx) throw new Error("useStudy must be used inside <StudyProvider>");
  return ctx;
}
