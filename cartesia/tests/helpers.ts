import type { TransportHandlers, VoiceTransport } from "../src/services/transport";
import type { ResearchContext, TranscriptEntry, VoiceEvent } from "../src/types";

export async function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("until(): timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function collect(bus: { subscribe(l: (e: VoiceEvent) => void): () => void }): VoiceEvent[] {
  const events: VoiceEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return events;
}

/** A transport fully controlled by the test. */
export class FakeTransport implements VoiceTransport {
  readonly mode = "live" as const;
  handlers: TransportHandlers | null = null;
  connectCalls = 0;
  closed = false;
  muted = false;
  constructor(private readonly onConnect?: (h: TransportHandlers) => Promise<void> | void) {}
  async connect(_c: ResearchContext, h: TransportHandlers) {
    this.connectCalls++;
    this.handlers = h;
    await this.onConnect?.(h);
  }
  setMuted(m: boolean) {
    this.muted = m;
  }
  close() {
    this.closed = true;
  }
}

export const entry = (id: string, role: TranscriptEntry["role"], text: string, offsetSeconds = 0): TranscriptEntry => ({
  id,
  role,
  text,
  offsetSeconds,
  timestamp: new Date(0).toISOString(),
  final: true,
});
