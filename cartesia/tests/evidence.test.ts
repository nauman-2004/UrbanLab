import { describe, expect, it } from "vitest";
import { toUrbanLabCall, toUrbanLabCells } from "../src/adapters/urbanlab";
import { DEMO_CONTEXT } from "../src/mock/demo-context";
import { MOCK_SCRIPTS } from "../src/mock/demo-transcript";
import { buildResult, MockEvidenceExtractor, RemoteEvidenceExtractor, validateExtraction } from "../src/services/evidence";
import type { EvidenceValue } from "../src/types";
import { entry } from "./helpers";

const scripted = MOCK_SCRIPTS.happy.map((s, i) => entry(s.id, s.role, s.text, i * 4));

const ev = (o: Partial<EvidenceValue>): EvidenceValue => ({
  field: "current_charger_count",
  value: 6,
  source: "cartesia",
  method: "interview",
  verification: "unverified",
  confidence: 0.9,
  evidenceId: "ev-x",
  quote: "We have six.",
  transcriptEntryId: "p",
  extractor: "test",
  ...o,
});

describe("6. mock evidence extraction", () => {
  it("extracts exactly the scripted facts", async () => {
    const out = await new MockEvidenceExtractor().extract(DEMO_CONTEXT, scripted, "s1");
    const m = Object.fromEntries(out.values.map((v) => [v.field, v.value]));
    expect(m).toEqual({
      ev_chargers_present: true,
      current_charger_count: 6,
      expansion_planned: true,
      additional_chargers_planned: 6,
      expansion_timeline: "next year",
    });
    expect(out.unknown.map((u) => u.field)).toEqual(["charger_accessibility"]);
    expect(out.values.find((v) => v.field === "current_charger_count")).toMatchObject({
      source: "cartesia",
      method: "interview",
      verification: "unverified",
      quote: "Yes, we currently have six.",
      transcriptEntryId: "mock-p2",
      evidenceId: "ev-s1-current_charger_count",
    });
  });

  it("is not a parser: a real transcript with the same meaning yields nothing", async () => {
    const live = [entry("turn-2-participant", "participant", "Yes, we currently have six.")];
    const out = await new MockEvidenceExtractor().extract(DEMO_CONTEXT, live, "s1");
    expect(out.values).toEqual([]);
  });

  it("a scripted id with altered text yields nothing", async () => {
    const out = await new MockEvidenceExtractor().extract(DEMO_CONTEXT, [entry("mock-p2", "participant", "Yes, we have ten.")], "s1");
    expect(out.values).toEqual([]);
  });
});

describe("validation never lets an extractor invent evidence", () => {
  const t = [entry("a", "agent", "How many chargers?"), entry("p", "participant", "We have six."), entry("p2", "participant", "Sorry, eight.")];
  it("drops unrequested fields, wrong types, agent quotes, missing quotes and unknown entries", () => {
    const out = validateExtraction(DEMO_CONTEXT, t, {
      values: [
        ev({ field: "made_up_field" }),
        ev({ value: "six" }),
        ev({ value: 6.5 }),
        ev({ transcriptEntryId: "a" }),
        ev({ quote: "  " }),
        ev({ transcriptEntryId: "nope" }),
        ev({ field: "ev_chargers_present", value: "yes" }),
      ],
      unknown: [],
    });
    expect(out.values).toEqual([]);
  });

  it("forces provenance to unverified interview evidence and clamps confidence", () => {
    const out = validateExtraction(DEMO_CONTEXT, t, {
      values: [{ ...ev({ confidence: 7 }), verification: "verified" as never, source: "costar" as never }],
      unknown: [],
    });
    expect(out.values[0]).toMatchObject({ source: "cartesia", method: "interview", verification: "unverified", confidence: 1 });
  });

  it("a later correction wins over an earlier answer", () => {
    const out = validateExtraction(DEMO_CONTEXT, t, {
      values: [ev({ value: 8, transcriptEntryId: "p2", quote: "Sorry, eight." }), ev({ value: 6, transcriptEntryId: "p" })],
      unknown: [],
    });
    expect(out.values).toHaveLength(1);
    expect(out.values[0].value).toBe(8);
  });

  it("declined discards everything", () => {
    const out = validateExtraction(DEMO_CONTEXT, t, { values: [ev({})], unknown: [], declined: true });
    expect(out.values).toEqual([]);
    expect(out.declined).toBe(true);
  });
});

describe("7/8. result generation", () => {
  it("every requested field gets an outcome; missing stays null with a reason", () => {
    const r = buildResult({
      context: DEMO_CONTEXT,
      sessionId: "s1",
      mode: "live",
      transcript: [entry("p", "participant", "We have six.")],
      extraction: { values: [ev({ evidenceId: "ev-s1-current_charger_count" })], unknown: [{ field: "charger_accessibility", reason: "Didn't know" }] },
      extractor: { name: "remote", isMock: false, extract: async () => ({ values: [], unknown: [] }) },
      startedAt: "2026-11-15T10:00:00.000Z",
      endedAt: "2026-11-15T10:01:05.000Z",
    });
    expect(r.fields).toHaveLength(DEMO_CONTEXT.missingEvidence.length);
    expect(r.fields.find((f) => f.key === "current_charger_count")).toMatchObject({ status: "collected", value: 6 });
    expect(r.fields.find((f) => f.key === "charger_accessibility")).toMatchObject({ status: "unknown", value: null, reason: "Didn't know" });
    const missing = r.fields.find((f) => f.key === "expansion_planned")!;
    expect(missing).toMatchObject({ status: "missing", value: null, reason: "Not answered in the interview." });
    expect(r.status).toBe("partial"); // required fields still missing
    expect(r.durationSeconds).toBe(65);
  });

  it("failed when an error occurred and nothing was collected", () => {
    const r = buildResult({
      context: DEMO_CONTEXT,
      sessionId: "s1",
      mode: "live",
      transcript: [],
      extraction: null,
      extractor: null,
      startedAt: null,
      error: { kind: "auth_failed", message: "no" },
    });
    expect(r.status).toBe("failed");
    expect(r.evidence).toEqual([]);
    expect(r.fields.every((f) => f.value === null)).toBe(true);
  });
});

describe("UrbanLab adapter (main's Cell / Call model)", () => {
  it("maps to survey cells: booleans 1/0, missing with reason, STUB prefix for mock", async () => {
    const out = await new MockEvidenceExtractor().extract(DEMO_CONTEXT, scripted, "s1");
    const r = buildResult({ context: DEMO_CONTEXT, sessionId: "s1", mode: "mock", transcript: scripted, extraction: validateExtraction(DEMO_CONTEXT, scripted, out), extractor: new MockEvidenceExtractor(), startedAt: null });
    const cells = toUrbanLabCells(r, 1);
    const count = cells.find((c) => c.variable === "current_charger_count")!;
    expect(count).toMatchObject({ building_id: "HOU-018", value: 6, source: "survey", status: "filled", note: "Self-reported via Cartesia voice interview, unverified." });
    expect(count.evidence_ref).toBe('STUB cartesia:s1 @ 00:12: "Yes, we currently have six."');
    expect(cells.find((c) => c.variable === "ev_chargers_present")!.value).toBe(1);
    expect(cells.find((c) => c.variable === "charger_accessibility")).toMatchObject({ value: null, status: "missing" });
    const call = toUrbanLabCall(r, DEMO_CONTEXT);
    expect(call.stub).toBe(true);
    expect(call.transcript[1]).toEqual({ speaker: "contact", text: "Sure, go ahead.", t: 4 });
  });
});

describe("RemoteEvidenceExtractor (Gemini/backend boundary)", () => {
  it("never sends host-only knownContext", async () => {
    let sent = "";
    const f = (async (_u: string, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ values: [], unknown: [] }));
    }) as unknown as typeof fetch;
    await new RemoteEvidenceExtractor("/x", "remote", f).extract(DEMO_CONTEXT, scripted, "s1");
    expect(sent).not.toContain("knownContext");
    expect(JSON.parse(sent).context.propertyId).toBe("HOU-018");
  });
});
