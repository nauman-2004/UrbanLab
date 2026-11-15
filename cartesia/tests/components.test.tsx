import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalGate } from "../src/components/ApprovalGate";
import { EvidenceExtraction } from "../src/components/EvidenceExtraction";
import { VoiceTranscript } from "../src/components/VoiceTranscript";
import { DEMO_CONTEXT } from "../src/mock/demo-context";
import { buildResult } from "../src/services/evidence";
import { entry } from "./helpers";

describe("4. transcript rendering", () => {
  it("renders agent and participant turns with timestamps", () => {
    const html = renderToStaticMarkup(
      <VoiceTranscript
        participantLabel="Property manager"
        entries={[entry("a", "agent", "Does this property currently have EV charging stations?", 4), entry("p", "participant", "Yes, we currently have six.", 9)]}
      />,
    );
    expect(html).toContain("UrbanLab interviewer");
    expect(html).toContain("Property manager");
    expect(html).toContain("Does this property currently have EV charging stations?");
    expect(html).toContain("Yes, we currently have six.");
    expect(html).toContain("00:09");
  });
  it("shows an empty state", () => {
    expect(renderToStaticMarkup(<VoiceTranscript entries={[]} />)).toContain("transcript appears here");
  });
});

describe("approval gate UI", () => {
  it("lists the property, missing evidence and both actions", () => {
    const html = renderToStaticMarkup(<ApprovalGate context={DEMO_CONTEXT} mode="live" onApprove={() => {}} onCancel={() => {}} />);
    for (const s of ["Primary evidence collection", "Houston Commerce Center", "HOU-018", "Current charger count", "Cartesia voice research", "Cancel", "Approve &amp; Start"])
      expect(html).toContain(s);
  });
});

describe("12. signature: ? Missing -> 6 [Cartesia]", () => {
  it("extraction view shows collected values with Cartesia provenance and missing ones as '? Missing'", () => {
    const transcript = [entry("p", "participant", "Yes, we currently have six.", 12)];
    const result = buildResult({
      context: DEMO_CONTEXT,
      sessionId: "s1",
      mode: "mock",
      transcript,
      extraction: {
        values: [
          {
            field: "current_charger_count",
            value: 6,
            source: "cartesia",
            method: "interview",
            verification: "unverified",
            confidence: 0.9,
            evidenceId: "ev-s1-current_charger_count",
            quote: "Yes, we currently have six.",
            transcriptEntryId: "p",
            extractor: "mock-scripted",
          },
        ],
        unknown: [],
      },
      extractor: { name: "mock-scripted", isMock: true, extract: async () => ({ values: [], unknown: [] }) },
      startedAt: null,
    });
    const html = renderToStaticMarkup(<EvidenceExtraction result={result} />);
    expect(html).toMatch(/>6<\/span>.*Cartesia/s);
    expect(html).toContain(">? Missing</span>");
    expect(html).toContain("Mock extractor");
    expect(html).toContain("verification = unverified");
  });
});
