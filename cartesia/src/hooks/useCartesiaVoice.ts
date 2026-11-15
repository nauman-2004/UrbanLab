"use client";

/**
 * React hook over `VoiceResearchSession`. Components use this; they never touch
 * WebSockets, audio or Cartesia directly.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MockEvidenceExtractor } from "../services/evidence";
import { CartesiaVoiceTransport } from "../services/cartesia";
import { MockVoiceTransport } from "../services/mock";
import { VoiceResearchSession, type VoiceSessionState } from "../services/session";
import type { VoiceEventBus } from "../services/events";
import type { TransportFactory } from "../services/transport";
import type { MockScenario } from "../mock/demo-transcript";
import type { EvidenceExtractor, ResearchContext, VoiceApproval, VoiceMode } from "../types";

export interface UseCartesiaVoiceOptions {
  mode: VoiceMode;
  /** Mock mode only. */
  scenario?: MockScenario;
  /** Defaults to the clearly-labelled mock extractor. */
  extractor?: EvidenceExtractor;
  /** Override the transport entirely (tests, custom hosts). */
  createTransport?: TransportFactory;
  bus?: VoiceEventBus;
  sessionEndpoint?: string;
}

export interface CartesiaVoice {
  state: VoiceSessionState;
  status: VoiceSessionState["status"];
  isConnected: boolean;
  isListening: boolean;
  isAgentSpeaking: boolean;
  isMuted: boolean;
  transcript: VoiceSessionState["transcript"];
  error: VoiceSessionState["error"];
  result: VoiceSessionState["result"];
  bus: VoiceEventBus;
  load(context: ResearchContext): void;
  approve(): VoiceApproval;
  cancel(): void;
  startSession(approval?: VoiceApproval): Promise<void>;
  endSession(): Promise<void>;
  mute(): void;
  unmute(): void;
  reset(): void;
}

export function useCartesiaVoice(options: UseCartesiaVoiceOptions): CartesiaVoice {
  const { mode, scenario, extractor, createTransport, bus, sessionEndpoint } = options;

  const [session] = useState(
    () =>
      new VoiceResearchSession({
        mode,
        bus,
        extractor: extractor ?? new MockEvidenceExtractor({ fail: mode === "mock" && scenario === "extraction_failed" }),
        createTransport:
          createTransport ??
          (() => (mode === "live" ? new CartesiaVoiceTransport({ sessionEndpoint }) : new MockVoiceTransport({ scenario }))),
      }),
  );

  useEffect(() => () => session.dispose(), [session]);

  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  return useMemo<CartesiaVoice>(
    () => ({
      state,
      status: state.status,
      isConnected: state.status === "live",
      isListening: state.status === "live" && !state.isMuted,
      isAgentSpeaking: state.isAgentSpeaking,
      isMuted: state.isMuted,
      transcript: state.transcript,
      error: state.error,
      result: state.result,
      bus: session.bus,
      load: (c) => session.load(c),
      approve: () => session.approve(),
      cancel: () => session.cancel(),
      startSession: (a) => session.start(a),
      endSession: () => session.end(),
      mute: () => session.mute(),
      unmute: () => session.unmute(),
      reset: () => session.reset(),
    }),
    [state, session],
  );
}
