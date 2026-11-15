/**
 * MOCK transport: a deterministic, scripted voice session. No network, no
 * microphone, no Cartesia. It drives the exact same controller and UI as the
 * live transport, so the demo works if Wi-Fi, Cartesia, permissions or rate
 * limits fail. Clearly labelled as mock in the UI and in every result.
 */
import { MOCK_SCRIPTS, type MockScenario } from "../mock/demo-transcript";
import type { ResearchContext } from "../types";
import { voiceLog } from "./logger";
import { VoiceFailure, type TransportHandlers, type VoiceTransport } from "./transport";

export interface MockTransportOptions {
  scenario?: MockScenario;
  /** 1 = natural pacing; tests use large values. */
  speed?: number;
}

export class MockVoiceTransport implements VoiceTransport {
  readonly mode = "mock" as const;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;
  private muted = false;
  private readonly scenario: MockScenario;
  private readonly speed: number;

  constructor(options: MockTransportOptions = {}) {
    this.scenario = options.scenario ?? "happy";
    this.speed = Math.max(0.1, options.speed ?? 1);
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, (seconds * 1000) / this.speed);
      this.timers.add(t);
    });
  }

  async connect(_context: ResearchContext, h: TransportHandlers): Promise<void> {
    h.onPhase("requesting_microphone");
    await this.wait(0.3);
    if (this.scenario === "microphone_denied")
      throw new VoiceFailure({ kind: "microphone_denied", message: "Microphone permission was denied (mock scenario)." });

    h.onPhase("connecting");
    await this.wait(0.5);
    if (this.scenario === "auth_failed")
      throw new VoiceFailure({ kind: "auth_failed", message: "Cartesia rejected the API key (mock scenario)." });
    if (this.closed) return;

    voiceLog("VOICE SESSION STARTED", { mode: "mock", scenario: this.scenario });
    h.onReady({ callId: `mock-${this.scenario}` });
    void this.play(h);
  }

  private async play(h: TransportHandlers): Promise<void> {
    const key = this.scenario === "extraction_failed" ? "happy" : this.scenario;
    const script = MOCK_SCRIPTS[key as keyof typeof MOCK_SCRIPTS] ?? MOCK_SCRIPTS.happy;
    let turn = 0;
    for (const step of script) {
      await this.wait(step.pause);
      if (this.closed) return;
      turn += 1;
      h.onTranscript({ kind: "start", turn, role: step.role, id: step.id });
      const words = step.text.split(/(?<=\s)/); // keep trailing spaces so deltas concatenate verbatim
      for (const w of words) {
        await this.wait(step.role === "agent" ? 0.07 : 0.09);
        if (this.closed) return;
        const level = 0.35 + 0.5 * Math.abs(Math.sin(turn * 7 + w.length));
        h.onActivity({
          inputLevel: step.role === "participant" && !this.muted ? level : 0,
          outputLevel: step.role === "agent" ? level : 0,
          agentSpeaking: step.role === "agent",
        });
        if (step.role === "agent") h.onTranscript({ kind: "delta", turn, role: "agent", text: w, id: step.id });
      }
      h.onTranscript({ kind: "end", turn, role: step.role, text: step.text, id: step.id });
      h.onActivity({ inputLevel: 0, outputLevel: 0, agentSpeaking: false });
    }
    await this.wait(0.6);
    if (this.closed) return;
    if (this.scenario === "disconnect") h.onError({ kind: "disconnected", message: "The voice connection dropped unexpectedly (mock scenario)." }, true);
    else h.onRemoteEnd();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
