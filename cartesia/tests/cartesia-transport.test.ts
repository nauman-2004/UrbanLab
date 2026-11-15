import { describe, expect, it } from "vitest";
import { DEMO_CONTEXT } from "../src/mock/demo-context";
import type { AudioIO, AudioPlayer, MicrophoneHandle } from "../src/services/audio";
import { CartesiaVoiceTransport } from "../src/services/cartesia";
import type { TransportHandlers } from "../src/services/transport";
import { until } from "./helpers";

class FakeWS {
  static last: FakeWS | null = null;
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(d: string) {
    this.sent.push(d);
  }
  close(code: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  serverSends(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverCloses(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function fakeAudio(opts: { denyMic?: boolean } = {}) {
  const log = { micOpened: 0, micStopped: 0, played: 0, cleared: 0, playerClosed: 0 };
  let push: ((c: Float32Array) => void) | null = null;
  const audio: AudioIO = {
    async openMicrophone(): Promise<MicrophoneHandle> {
      if (opts.denyMic) {
        const { VoiceFailure } = await import("../src/services/transport");
        throw new VoiceFailure({ kind: "microphone_denied", message: "denied" });
      }
      log.micOpened++;
      return { level: 0.2, start: (cb) => (push = cb), stop: () => log.micStopped++ };
    },
    createPlayer(): AudioPlayer {
      return { isPlaying: false, level: 0, enqueue: () => log.played++, clear: () => log.cleared++, close: () => log.playerClosed++ };
    },
  };
  return { audio, log, speak: (c: Float32Array) => push?.(c) };
}

function handlers() {
  const calls: { phases: string[]; ready: number; transcript: unknown[]; remoteEnd: number; errors: { kind: string; fatal: boolean }[] } = {
    phases: [],
    ready: 0,
    transcript: [],
    remoteEnd: 0,
    errors: [],
  };
  const h: TransportHandlers = {
    onPhase: (p) => calls.phases.push(p),
    onReady: () => calls.ready++,
    onTranscript: (u) => calls.transcript.push(u),
    onActivity: () => undefined,
    onRemoteEnd: () => calls.remoteEnd++,
    onError: (e, fatal) => calls.errors.push({ kind: e.kind, fatal }),
  };
  return { h, calls };
}

const grant = { session: { url: "wss://api.cartesia.ai/v1/agents/websocket/agent_123", token: "tok_secret", expiresAt: "", callId: "c1" } };

function okFetch() {
  const requests: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(grant), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, requests };
}

async function connected() {
  FakeWS.last = null;
  const { audio, log, speak } = fakeAudio();
  const { f, requests } = okFetch();
  const t = new CartesiaVoiceTransport({ audio, fetchImpl: f, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
  const { h, calls } = handlers();
  const p = t.connect(DEMO_CONTEXT, h);
  await until(() => FakeWS.last?.sent.length === 1);
  const ws = FakeWS.last!;
  ws.serverSends({ type: "session_ready", call_id: "c1", agent_id: "agent_123", audio: { input_format: "pcm_16000" } });
  await p;
  return { t, ws, calls, log, speak, requests };
}

describe("live Cartesia transport (protocol-level, fake socket)", () => {
  it("3. opens mic, mints a session server-side, connects with token, sends session_create", async () => {
    const { ws, calls, log, requests } = await connected();
    expect(calls.phases).toEqual(["requesting_microphone", "connecting"]);
    expect(log.micOpened).toBe(1);
    expect(requests[0].url).toBe("/api/cartesia/session");
    // host-only context is never sent anywhere
    expect(JSON.stringify(requests[0].body)).not.toContain("knownContext");
    const u = new URL(ws.url);
    expect(u.origin + u.pathname).toBe("wss://api.cartesia.ai/v1/agents/websocket/agent_123");
    expect(u.searchParams.get("cartesia_version")).toBe("2026-08-14");
    expect(u.searchParams.get("access_token")).toBe("tok_secret");
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "session_create", audio: { input_format: "pcm_16000" } });
    expect(calls.ready).toBe(1);
  });

  it("streams mic as audio_input, sends silence when muted, plays and clears agent audio", async () => {
    const { t, ws, log, speak } = await connected();
    speak(new Float32Array(1600).fill(0.5));
    const sent = JSON.parse(ws.sent[1]);
    expect(sent.type).toBe("audio_input");
    expect(sent.audio.length).toBeGreaterThan(100);
    t.setMuted(true);
    speak(new Float32Array(1600).fill(0.5));
    const muted = JSON.parse(ws.sent[2]);
    expect(atob(muted.audio).split("").every((c) => c === "\0")).toBe(true);

    ws.serverSends({ type: "audio_output", audio: btoa("\x00\x10\x00\x20") });
    ws.serverSends({ type: "audio_output_clear" });
    expect(log.played).toBe(1);
    expect(log.cleared).toBe(1);
  });

  it("4. turn events become transcript updates; unknown types are ignored", async () => {
    const { ws, calls } = await connected();
    ws.serverSends({ type: "turn_started", turn: 1, role: "assistant", start_time: 0 });
    ws.serverSends({ type: "turn_output_text_delta", turn: 1, role: "assistant", text: "Hi" });
    ws.serverSends({ type: "turn_ended", turn: 2, role: "user", text: "Yes, six.", interrupted: false, start_time: 0, end_time: 1, tool_calls: [] });
    ws.serverSends({ type: "some_future_event", foo: 1 });
    expect(calls.transcript).toEqual([
      { kind: "start", turn: 1, role: "agent" },
      { kind: "delta", turn: 1, role: "agent", text: "Hi" },
      { kind: "end", turn: 2, role: "participant", text: "Yes, six.", interrupted: false },
    ]);
  });

  it("answers client tool calls with an error so the agent never hangs", async () => {
    const { ws } = await connected();
    ws.serverSends({ type: "client_tool_call", tool_call_id: "t1", tool_name: "x", parameters: {}, expects_response: true });
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ type: "client_tool_result", tool_call_id: "t1", is_error: true });
  });

  it("5. local close stops the mic, the player and the socket", async () => {
    const { t, ws, log, calls } = await connected();
    t.close();
    expect(ws.closedWith).toBe(1000);
    expect(log.micStopped).toBe(1);
    expect(log.playerClosed).toBe(1);
    expect(calls.remoteEnd).toBe(0);
  });

  it("remote normal close = agent ended the call; abnormal close = disconnect", async () => {
    const a = await connected();
    a.ws.serverCloses(1000);
    expect(a.calls.remoteEnd).toBe(1);
    const b = await connected();
    b.ws.serverCloses(1006);
    expect(b.calls.errors).toEqual([{ kind: "disconnected", fatal: true }]);
  });

  it("fatal agent error ends the session", async () => {
    const { ws, calls, log } = await connected();
    ws.serverSends({ type: "error", code: "agent_failed", message: "boom", fatal: true });
    expect(calls.errors).toEqual([{ kind: "agent_error", fatal: true }]);
    expect(log.micStopped).toBe(1);
  });

  it("9. microphone denied: no session is minted, no socket opened", async () => {
    FakeWS.last = null;
    const { audio } = fakeAudio({ denyMic: true });
    const { f, requests } = okFetch();
    const t = new CartesiaVoiceTransport({ audio, fetchImpl: f, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    await expect(t.connect(DEMO_CONTEXT, handlers().h)).rejects.toMatchObject({ voiceError: { kind: "microphone_denied" } });
    expect(requests).toHaveLength(0);
    expect(FakeWS.last).toBeNull();
  });

  it("9. auth failure from the server route is surfaced and the mic is released", async () => {
    const { audio, log } = fakeAudio();
    const f = (async () =>
      new Response(JSON.stringify({ error: { kind: "auth_failed", message: "Cartesia rejected the API key (401)." } }), { status: 401 })) as unknown as typeof fetch;
    const t = new CartesiaVoiceTransport({ audio, fetchImpl: f, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    await expect(t.connect(DEMO_CONTEXT, handlers().h)).rejects.toMatchObject({ voiceError: { kind: "auth_failed" } });
    expect(log.micStopped).toBe(1);
  });

  it("connection closing before session_ready is a connection failure", async () => {
    const { audio } = fakeAudio();
    const { f } = okFetch();
    const t = new CartesiaVoiceTransport({ audio, fetchImpl: f, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    FakeWS.last = null;
    const p = t.connect(DEMO_CONTEXT, handlers().h);
    await until(() => FakeWS.last?.sent.length === 1);
    FakeWS.last!.serverCloses(1008);
    await expect(p).rejects.toMatchObject({ voiceError: { kind: "connection_failed" } });
  });
});
