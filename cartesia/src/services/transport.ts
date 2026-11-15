/**
 * The seam between the session controller and a voice backend. The live
 * Cartesia transport and the deterministic mock transport both implement it,
 * so the same UI and controller work in both modes.
 */
import type { ResearchContext, VoiceError, VoiceMode } from "../types";
import type { TranscriptUpdate } from "./protocol";

/** Thrown by transports for expected, user-presentable failures. */
export class VoiceFailure extends Error {
  constructor(readonly voiceError: VoiceError) {
    super(voiceError.message);
    this.name = "VoiceFailure";
  }
}

export interface TransportHandlers {
  onPhase(phase: "requesting_microphone" | "connecting"): void;
  /** The voice session is up and audio is flowing. */
  onReady(info: { callId: string | null }): void;
  onTranscript(update: TranscriptUpdate): void;
  onActivity(activity: { inputLevel: number; outputLevel: number; agentSpeaking: boolean }): void;
  /** The remote side ended the conversation normally (e.g. the agent hung up). */
  onRemoteEnd(): void;
  /** Something failed after connecting. `fatal` means the session is over. */
  onError(error: VoiceError, fatal: boolean): void;
}

export interface VoiceTransport {
  readonly mode: VoiceMode;
  /**
   * Opens the microphone (live) and the voice session. MUST only be called after
   * human approval; the controller enforces this. Rejects with `VoiceFailure`.
   */
  connect(context: ResearchContext, handlers: TransportHandlers): Promise<void>;
  setMuted(muted: boolean): void;
  /** Local end: stops audio and closes the connection. Idempotent. */
  close(): void;
}

export type TransportFactory = () => VoiceTransport;
