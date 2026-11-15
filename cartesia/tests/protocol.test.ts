import { describe, expect, it } from "vitest";
import { ChunkBuffer, float32ToPcm16Base64, pcm16Base64ToFloat32, resample } from "../src/services/audio";
import { redact } from "../src/services/logger";
import { applyTranscriptUpdate, buildAgentSocketUrl, parseServerMessage } from "../src/services/protocol";

describe("protocol", () => {
  it("parses documented messages and ignores unknown/malformed ones", () => {
    expect(parseServerMessage('{"type":"session_ready","call_id":"c"}')).toEqual({ type: "session_ready", call_id: "c", agent_id: undefined });
    expect(parseServerMessage('{"type":"turn_ended","turn":2,"role":"user","text":"hi","interrupted":false}')).toMatchObject({ role: "user", text: "hi" });
    expect(parseServerMessage('{"type":"new_thing"}')).toBeNull();
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage('{"type":"turn_started","turn":"x","role":"user"}')).toBeNull();
  });

  it("builds the browser socket URL with an encoded token", () => {
    const u = new URL(buildAgentSocketUrl("wss://api.cartesia.ai/v1/agents/websocket/a1", "a+b/c="));
    expect(u.searchParams.get("access_token")).toBe("a+b/c=");
    expect(u.searchParams.get("cartesia_version")).toBe("2026-08-14");
  });

  it("assembles streamed agent turns and replaces with the final text", () => {
    const now = new Date(0);
    let t = applyTranscriptUpdate([], { kind: "start", turn: 1, role: "agent" }, now, 1.23);
    t = applyTranscriptUpdate(t, { kind: "delta", turn: 1, role: "agent", text: "Hel" }, now, 2);
    t = applyTranscriptUpdate(t, { kind: "delta", turn: 1, role: "agent", text: "lo " }, now, 2);
    expect(t[0]).toMatchObject({ id: "turn-1-agent", text: "Hello ", final: false, offsetSeconds: 1.2 });
    t = applyTranscriptUpdate(t, { kind: "end", turn: 1, role: "agent", text: "Hello there." }, now, 3);
    expect(t[0]).toMatchObject({ text: "Hello there.", final: true });
    t = applyTranscriptUpdate(t, { kind: "end", turn: 2, role: "participant", text: "Hi" }, now, 4);
    t = applyTranscriptUpdate(t, { kind: "drop", turn: 2, role: "participant" }, now, 4);
    expect(t).toHaveLength(1);
  });
});

describe("audio helpers", () => {
  it("PCM16 round trip", () => {
    const x = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const y = pcm16Base64ToFloat32(float32ToPcm16Base64(x));
    y.forEach((v, i) => expect(v).toBeCloseTo(x[i], 3));
  });
  it("resamples 48k -> 16k and chunks into 100 ms frames", () => {
    expect(resample(new Float32Array(4800), 48000, 16000)).toHaveLength(1600);
    const out: number[] = [];
    const b = new ChunkBuffer(1600);
    b.push(new Float32Array(1000), (c) => out.push(c.length));
    b.push(new Float32Array(2500), (c) => out.push(c.length));
    expect(out).toEqual([1600, 1600]);
  });
});

describe("logger redaction", () => {
  it("redacts credential-looking keys and values", () => {
    expect(redact({ token: "abc", apiKey: "x", note: "key sk_car_12345 here", nested: { authorization: "Bearer zzz" } })).toEqual({
      token: "[redacted]",
      apiKey: "[redacted]",
      note: "key [redacted] here",
      nested: { authorization: "[redacted]" },
    });
  });
});
