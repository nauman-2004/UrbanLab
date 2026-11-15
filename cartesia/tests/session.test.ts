import { describe, expect, it } from "vitest";
import { DEMO_CONTEXT } from "../src/mock/demo-context";
import { MockEvidenceExtractor } from "../src/services/evidence";
import { MockVoiceTransport } from "../src/services/mock";
import { VoiceResearchSession } from "../src/services/session";
import { VoiceFailure } from "../src/services/transport";
import type { MockScenario } from "../src/mock/demo-transcript";
import { collect, FakeTransport, until } from "./helpers";

function mockSession(scenario: MockScenario = "happy") {
  let created = 0;
  const s = new VoiceResearchSession({
    mode: "mock",
    extractor: new MockEvidenceExtractor({ fail: scenario === "extraction_failed" }),
    createTransport: () => {
      created++;
      return new MockVoiceTransport({ scenario, speed: 400 });
    },
  });
  return { s, created: () => created };
}

describe("approval gate", () => {
  it("1. refuses to start without approval and never creates a transport", async () => {
    let created = 0;
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => (created++, new FakeTransport()) });
    s.load(DEMO_CONTEXT);
    await s.start();
    expect(created).toBe(0);
    expect(s.getSnapshot().status).toBe("awaiting_approval");
    expect(s.getSnapshot().error?.kind).toBe("approval_required");
  });

  it("1b. rejects an approval for a different context", async () => {
    let created = 0;
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => (created++, new FakeTransport()) });
    s.load(DEMO_CONTEXT);
    const forged = { approvalId: "x", studyId: DEMO_CONTEXT.studyId, propertyId: "OTHER", fieldKeys: [], approvedAt: "" };
    await s.start(forged);
    expect(created).toBe(0);
  });

  it("2. cancel before start prevents any connection", async () => {
    const t = new FakeTransport();
    let created = 0;
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => (created++, t) });
    const events = collect(s.bus);
    s.load(DEMO_CONTEXT);
    s.cancel();
    await s.start(); // even a later start is a no-op
    expect(created).toBe(0);
    expect(t.connectCalls).toBe(0);
    expect(s.getSnapshot().status).toBe("cancelled");
    expect(events.map((e) => e.type)).toEqual(["VOICE_SESSION_CANCELLED"]);
  });
});

describe("controller with a live-like transport", () => {
  it("3/5. connects after approval, records transcript, and ends cleanly on user End", async () => {
    const t = new FakeTransport((h) => {
      h.onPhase("requesting_microphone");
      h.onPhase("connecting");
      h.onReady({ callId: "call_1" });
    });
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => t });
    const events = collect(s.bus);
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    expect(s.getSnapshot().status).toBe("live");
    expect(s.getSnapshot().callId).toBe("call_1");

    t.handlers!.onTranscript({ kind: "start", turn: 1, role: "agent" });
    t.handlers!.onTranscript({ kind: "delta", turn: 1, role: "agent", text: "Does this property " });
    t.handlers!.onTranscript({ kind: "delta", turn: 1, role: "agent", text: "have EV chargers?" });
    t.handlers!.onTranscript({ kind: "end", turn: 1, role: "agent", text: "Does this property have EV chargers?" });
    t.handlers!.onTranscript({ kind: "end", turn: 2, role: "participant", text: "Yes, we currently have six." });
    expect(s.getSnapshot().transcript.map((e) => e.role)).toEqual(["agent", "participant"]);

    await s.end();
    expect(t.closed).toBe(true);
    const st = s.getSnapshot();
    expect(st.status).toBe("done");
    // Live transcript + mock extractor => nothing extracted, nothing invented.
    expect(st.result!.evidence).toEqual([]);
    expect(st.result!.fields.every((f) => f.value === null)).toBe(true);
    expect(st.result!.status).toBe("partial");
    expect(events.map((e) => e.type)).toEqual([
      "VOICE_SESSION_APPROVED",
      "VOICE_SESSION_STARTED",
      "VOICE_TRANSCRIPT_UPDATED",
      "VOICE_TRANSCRIPT_UPDATED",
      "VOICE_EVIDENCE_EXTRACTED",
      "VOICE_SESSION_COMPLETED",
    ]);
  });

  it("mute/unmute reach the transport", async () => {
    const t = new FakeTransport((h) => h.onReady({ callId: null }));
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => t });
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    s.mute();
    expect(t.muted).toBe(true);
    expect(s.getSnapshot().isMuted).toBe(true);
    s.unmute();
    expect(t.muted).toBe(false);
  });

  it("9. microphone denied fails gracefully with no evidence", async () => {
    const t = new FakeTransport(() => {
      throw new VoiceFailure({ kind: "microphone_denied", message: "denied" });
    });
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => t });
    const events = collect(s.bus);
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    const st = s.getSnapshot();
    expect(st.status).toBe("failed");
    expect(st.error?.kind).toBe("microphone_denied");
    expect(st.result?.evidence).toEqual([]);
    expect(events.at(-1)?.type).toBe("VOICE_SESSION_FAILED");
    expect(events.some((e) => e.type === "VOICE_SESSION_STARTED")).toBe(false);
  });

  it("9b. unexpected disconnect keeps partial transcript and marks the error", async () => {
    const t = new FakeTransport((h) => h.onReady({ callId: null }));
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => t });
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    t.handlers!.onTranscript({ kind: "end", turn: 1, role: "participant", text: "We have some." });
    t.handlers!.onError({ kind: "disconnected", message: "dropped" }, true);
    await until(() => s.getSnapshot().status === "failed" || s.getSnapshot().status === "done");
    const st = s.getSnapshot();
    expect(st.error?.kind).toBe("disconnected");
    expect(st.result?.transcript).toHaveLength(1);
    expect(st.result?.evidence).toEqual([]);
    expect(st.result?.status).toBe("failed");
  });

  it("no participant speech -> no_transcript failure", async () => {
    const t = new FakeTransport((h) => h.onReady({ callId: null }));
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => t });
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    t.handlers!.onTranscript({ kind: "end", turn: 1, role: "agent", text: "Hello?" });
    t.handlers!.onRemoteEnd();
    await until(() => s.getSnapshot().status === "failed");
    expect(s.getSnapshot().error?.kind).toBe("no_transcript");
  });

  it("non-fatal errors are shown but do not end the session", async () => {
    const t = new FakeTransport((h) => h.onReady({ callId: null }));
    const s = new VoiceResearchSession({ mode: "live", extractor: new MockEvidenceExtractor(), createTransport: () => t });
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    t.handlers!.onError({ kind: "agent_error", message: "hiccup" }, false);
    expect(s.getSnapshot().status).toBe("live");
    expect(s.getSnapshot().error?.message).toBe("hiccup");
  });
});

describe("10. mock mode end to end", () => {
  it("happy path: approval -> session -> transcript -> evidence -> complete-with-unknown", async () => {
    const { s } = mockSession("happy");
    const events = collect(s.bus);
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    await until(() => s.getSnapshot().status === "done", 5000);
    const r = s.getSnapshot().result!;
    const v = Object.fromEntries(r.fields.map((f) => [f.key, f.value]));
    expect(v).toEqual({
      ev_chargers_present: true,
      current_charger_count: 6,
      charger_accessibility: null, // participant didn't know: preserved as unknown
      expansion_planned: true,
      additional_chargers_planned: 6,
      expansion_timeline: "next year",
    });
    expect(r.fields.find((f) => f.key === "charger_accessibility")?.status).toBe("unknown");
    expect(r.status).toBe("complete"); // all REQUIRED fields collected
    expect(r.mode).toBe("mock");
    expect(r.extractor?.isMock).toBe(true);
    expect(r.evidence.every((e) => e.source === "cartesia" && e.method === "interview" && e.verification === "unverified")).toBe(true);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("VOICE_SESSION_APPROVED");
    expect(types[1]).toBe("VOICE_SESSION_STARTED");
    expect(types.at(-2)).toBe("VOICE_EVIDENCE_EXTRACTED");
    expect(types.at(-1)).toBe("VOICE_SESSION_COMPLETED");
  });

  it("declined: nothing collected, status cancelled", async () => {
    const { s } = mockSession("declined");
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    await until(() => ["done", "failed"].includes(s.getSnapshot().status), 5000);
    const r = s.getSnapshot().result!;
    expect(r.declined).toBe(true);
    expect(r.status).toBe("cancelled");
    expect(r.evidence).toEqual([]);
    expect(r.fields.every((f) => f.value === null && f.reason === "Participant declined to take part.")).toBe(true);
  });

  it("disconnect: partial evidence from what was said before the drop", async () => {
    const { s } = mockSession("disconnect");
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    await until(() => ["done", "failed"].includes(s.getSnapshot().status), 5000);
    const r = s.getSnapshot().result!;
    expect(r.status).toBe("partial");
    expect(r.error?.kind).toBe("disconnected");
    expect(r.evidence.map((e) => e.field).sort()).toEqual(["current_charger_count", "ev_chargers_present"]);
  });

  it("auth failure and extraction failure never fabricate evidence", async () => {
    for (const scenario of ["auth_failed", "extraction_failed", "microphone_denied", "no_answer"] as const) {
      const { s } = mockSession(scenario);
      s.load(DEMO_CONTEXT);
      await s.start(s.approve());
      await until(() => ["done", "failed"].includes(s.getSnapshot().status), 5000);
      const st = s.getSnapshot();
      expect(st.status, scenario).toBe("failed");
      expect(st.result?.evidence ?? [], scenario).toEqual([]);
    }
  });

  it("user can end a mock session early; transcript so far is kept", async () => {
    const { s } = mockSession("happy");
    s.load(DEMO_CONTEXT);
    await s.start(s.approve());
    await until(() => s.getSnapshot().transcript.some((e) => e.id === "mock-p2" && e.final), 5000);
    await s.end();
    const r = s.getSnapshot().result!;
    expect(r.status).toBe("partial");
    expect(r.fields.find((f) => f.key === "current_charger_count")?.value).toBe(6);
    expect(r.fields.find((f) => f.key === "expansion_planned")?.value).toBeNull();
  });

  it("reset requires a fresh approval", async () => {
    const { s, created } = mockSession("happy");
    s.load(DEMO_CONTEXT);
    s.approve();
    s.reset();
    await s.start();
    expect(created()).toBe(0);
  });
});
