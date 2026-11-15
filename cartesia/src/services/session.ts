/**
 * VoiceResearchSession: the framework-agnostic controller behind `useCartesiaVoice`.
 *
 *   load(context) -> approve() -> start() -> [live] -> end() | remote end | error
 *                 \-> cancel()                 -> extracting -> done | failed
 *
 * Product rule enforced here: no transport (and therefore no microphone and no
 * Cartesia connection) is created until a human approval for this exact context exists.
 */
import { buildResult, validateExtraction } from "./evidence";
import { VoiceEventBus } from "./events";
import { voiceLog } from "./logger";
import { applyTranscriptUpdate } from "./protocol";
import { VoiceFailure, type TransportFactory, type TransportHandlers, type VoiceTransport } from "./transport";
import type {
  EvidenceExtractor,
  ExtractionOutput,
  ResearchContext,
  TranscriptEntry,
  VoiceApproval,
  VoiceError,
  VoiceMode,
  VoiceResearchResult,
  VoiceSessionStatus,
} from "../types";

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  mode: VoiceMode;
  sessionId: string;
  context: ResearchContext | null;
  approval: VoiceApproval | null;
  transcript: TranscriptEntry[];
  isMuted: boolean;
  isAgentSpeaking: boolean;
  inputLevel: number;
  outputLevel: number;
  startedAt: string | null;
  callId: string | null;
  error: VoiceError | null;
  result: VoiceResearchResult | null;
}

export interface VoiceSessionOptions {
  mode: VoiceMode;
  createTransport: TransportFactory;
  extractor: EvidenceExtractor;
  bus?: VoiceEventBus;
  now?: () => Date;
  newId?: () => string;
}

const defaultId = () =>
  `vs-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 10)}`;

const sameFields = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export class VoiceResearchSession {
  readonly bus: VoiceEventBus;
  private state: VoiceSessionState;
  private listeners = new Set<() => void>();
  private transport: VoiceTransport | null = null;
  private finishing = false;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly opts: VoiceSessionOptions) {
    this.bus = opts.bus ?? new VoiceEventBus();
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? defaultId;
    this.state = this.initial(null);
  }

  // ---------------------------------------------- external-store plumbing --

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceSessionState => this.state;

  private set(patch: Partial<VoiceSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private initial(context: ResearchContext | null): VoiceSessionState {
    return {
      status: context ? "awaiting_approval" : "idle",
      mode: this.opts.mode,
      sessionId: this.newId(),
      context,
      approval: null,
      transcript: [],
      isMuted: false,
      isAgentSpeaking: false,
      inputLevel: 0,
      outputLevel: 0,
      startedAt: null,
      callId: null,
      error: null,
      result: null,
    };
  }

  private base() {
    const c = this.state.context!;
    return { sessionId: this.state.sessionId, studyId: c.studyId, propertyId: c.propertyId, at: this.now().toISOString() };
  }

  // -------------------------------------------------------------- actions --

  /** Load a research context. Nothing connects; the session waits for approval. */
  load(context: ResearchContext): void {
    this.teardown();
    this.state = this.initial(context);
    for (const l of this.listeners) l();
  }

  /** Records explicit human approval for the loaded context. */
  approve(): VoiceApproval {
    const c = this.state.context;
    if (!c || this.state.status !== "awaiting_approval") throw new Error("Nothing is awaiting approval.");
    const approval: VoiceApproval = {
      approvalId: `ap-${this.state.sessionId}`,
      studyId: c.studyId,
      propertyId: c.propertyId,
      fieldKeys: c.missingEvidence.map((f) => f.key),
      approvedAt: this.now().toISOString(),
    };
    this.set({ approval });
    this.bus.emit({ type: "VOICE_SESSION_APPROVED", ...this.base(), approval });
    voiceLog("VOICE SESSION APPROVED", { propertyId: c.propertyId, fields: approval.fieldKeys.length });
    return approval;
  }

  /** User cancels before starting. Guarantees no connection was ever made. */
  cancel(): void {
    if (this.state.status !== "awaiting_approval") return;
    this.set({ status: "cancelled", approval: null });
    this.bus.emit({ type: "VOICE_SESSION_CANCELLED", ...this.base(), reason: "user_cancelled_before_start" });
    voiceLog("VOICE SESSION CANCELLED (before start)");
  }

  /** Starts the voice session. Refuses without a matching approval. */
  async start(approval: VoiceApproval | null = this.state.approval): Promise<void> {
    const c = this.state.context;
    if (!c || this.state.status !== "awaiting_approval") return;
    const valid =
      approval &&
      approval === this.state.approval &&
      approval.studyId === c.studyId &&
      approval.propertyId === c.propertyId &&
      sameFields(approval.fieldKeys, c.missingEvidence.map((f) => f.key));
    if (!valid) {
      this.set({ error: { kind: "approval_required", message: "Primary evidence collection must be approved before the voice session starts." } });
      return;
    }

    this.finishing = false;
    this.set({ status: "requesting_microphone", error: null });
    const transport = this.opts.createTransport();
    this.transport = transport;

    const handlers: TransportHandlers = {
      onPhase: (phase) => this.transport === transport && this.set({ status: phase }),
      onReady: ({ callId }) => {
        if (this.transport !== transport) return;
        this.set({ status: "live", startedAt: this.now().toISOString(), callId });
        this.bus.emit({ type: "VOICE_SESSION_STARTED", ...this.base(), mode: transport.mode });
      },
      onTranscript: (u) => {
        if (this.transport !== transport) return;
        const started = this.state.startedAt ? Date.parse(this.state.startedAt) : this.now().getTime();
        const now = this.now();
        const transcript = applyTranscriptUpdate(this.state.transcript, u, now, (now.getTime() - started) / 1000);
        this.set({ transcript });
        if (u.kind === "end") {
          const entry = transcript.find((e) => e.id === (u.id ?? `turn-${u.turn}-${u.role}`));
          if (entry) {
            this.bus.emit({ type: "VOICE_TRANSCRIPT_UPDATED", ...this.base(), entry });
            voiceLog("TRANSCRIPT RECEIVED", { role: entry.role, chars: entry.text.length });
          }
        }
      },
      onActivity: (a) =>
        this.transport === transport &&
        this.set({ inputLevel: a.inputLevel, outputLevel: a.outputLevel, isAgentSpeaking: a.agentSpeaking }),
      onRemoteEnd: () => this.transport === transport && void this.finish(null),
      onError: (error, fatal) => {
        if (this.transport !== transport) return;
        if (fatal) void this.finish(error);
        else this.set({ error });
      },
    };

    try {
      await transport.connect(c, handlers);
    } catch (err) {
      if (this.transport !== transport) return;
      const error: VoiceError =
        err instanceof VoiceFailure ? err.voiceError : { kind: "connection_failed", message: "Could not start the voice session." };
      await this.finish(error);
    }
  }

  /** User ends the research session. */
  async end(): Promise<void> {
    const s = this.state.status;
    if (s === "live" || s === "connecting" || s === "requesting_microphone") await this.finish(null);
  }

  mute(): void {
    this.transport?.setMuted(true);
    this.set({ isMuted: true });
  }

  unmute(): void {
    this.transport?.setMuted(false);
    this.set({ isMuted: false });
  }

  /** Back to approval for the same context (a fresh approval is required). */
  reset(): void {
    if (this.state.context) this.load(this.state.context);
  }

  dispose(): void {
    this.teardown();
    this.listeners.clear();
  }

  private teardown(): void {
    this.transport?.close();
    this.transport = null;
  }

  // ------------------------------------------------------------ finishing --

  private async finish(error: VoiceError | null): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    const c = this.state.context!;
    const wasLive = this.state.startedAt !== null;
    this.set({ status: "ending", isAgentSpeaking: false, inputLevel: 0, outputLevel: 0 });
    this.teardown();

    const transcript = this.state.transcript.filter((t) => t.text.trim());
    const participantSpoke = transcript.some((t) => t.role === "participant");
    let err = error;
    if (!err && wasLive && !participantSpoke) err = { kind: "no_transcript", message: "The participant did not say anything, so no evidence was collected." };

    let extraction: ExtractionOutput | null = null;
    if (participantSpoke) {
      this.set({ status: "extracting" });
      voiceLog("EVIDENCE EXTRACTION STARTED", { extractor: this.opts.extractor.name, turns: transcript.length });
      try {
        const raw = await this.opts.extractor.extract(c, transcript, this.state.sessionId);
        extraction = validateExtraction(c, transcript, raw);
        this.bus.emit({ type: "VOICE_EVIDENCE_EXTRACTED", ...this.base(), output: extraction, extractor: this.opts.extractor.name });
        voiceLog("EVIDENCE EXTRACTED", { values: extraction.values.length, unknown: extraction.unknown.length });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Evidence extraction failed.";
        err = err ?? { kind: "extraction_failed", message: `Evidence extraction failed: ${message}` };
      }
    }

    const result = buildResult({
      context: c,
      sessionId: this.state.sessionId,
      mode: this.opts.mode,
      transcript,
      extraction,
      extractor: this.opts.extractor,
      startedAt: this.state.startedAt,
      endedAt: this.now().toISOString(),
      error: err,
    });

    if (result.status === "failed") {
      this.set({ status: "failed", error: err, result, transcript });
      this.bus.emit({ type: "VOICE_SESSION_FAILED", ...this.base(), error: err!, result });
      voiceLog("SESSION FAILED", { kind: err?.kind });
    } else {
      this.set({ status: "done", error: err, result, transcript });
      this.bus.emit({ type: "VOICE_SESSION_COMPLETED", ...this.base(), result });
      voiceLog("SESSION COMPLETED", { status: result.status, values: result.evidence.length });
    }
  }
}
