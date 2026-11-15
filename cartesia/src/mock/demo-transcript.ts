/**
 * MOCK MODE scripts: deterministic interviews used when CARTESIA_DEMO_MODE=mock
 * (the hackathon fallback for no Wi-Fi / no mic / Cartesia down / rate limits).
 *
 * These are scripted demo transcripts, not recordings of real people, and the
 * evidence annotations below are the ground truth for `MockEvidenceExtractor`.
 * Nothing here is AI. It is labelled as mock everywhere it surfaces.
 */
import type { TranscriptRole } from "../types";

export type MockScenario =
  | "happy"
  | "declined"
  | "disconnect"
  | "no_answer"
  | "microphone_denied"
  | "auth_failed"
  | "extraction_failed";

export const MOCK_SCENARIOS: { id: MockScenario; label: string; description: string }[] = [
  { id: "happy", label: "Successful interview", description: "Participant answers; one item stays unknown." },
  { id: "declined", label: "Participant declines", description: "Consent refused; nothing is collected." },
  { id: "disconnect", label: "Unexpected disconnect", description: "Call drops midway; partial evidence." },
  { id: "no_answer", label: "No participant speech", description: "Agent speaks, nobody answers." },
  { id: "microphone_denied", label: "Microphone denied", description: "Browser permission refused." },
  { id: "auth_failed", label: "Cartesia auth failure", description: "Server could not mint a session." },
  { id: "extraction_failed", label: "Extraction failure", description: "Transcript OK, extractor throws." },
];

export interface MockStep {
  /** Stable id. The mock extractor only trusts annotations whose id AND text match. */
  id: string;
  role: TranscriptRole;
  text: string;
  /** Seconds after the previous step finished. */
  pause: number;
}

const CONSENT =
  "Hi, this is an automated research assistant from UrbanLab, calling about Houston Commerce Center. This short conversation is recorded for a research study. Is it okay if I ask you a few quick questions?";

export const MOCK_SCRIPTS: Record<"happy" | "declined" | "disconnect" | "no_answer", MockStep[]> = {
  happy: [
    { id: "mock-a1", role: "agent", text: CONSENT, pause: 0.6 },
    { id: "mock-p1", role: "participant", text: "Sure, go ahead.", pause: 0.7 },
    { id: "mock-a2", role: "agent", text: "Thanks. Does this property currently have EV charging stations?", pause: 0.6 },
    { id: "mock-p2", role: "participant", text: "Yes, we currently have six.", pause: 0.8 },
    {
      id: "mock-a3",
      role: "agent",
      text: "Got it, six chargers. Are they open to the public, or only for tenants?",
      pause: 0.6,
    },
    {
      id: "mock-p3",
      role: "participant",
      text: "Honestly, I'm not sure. I'd have to check with the garage operator.",
      pause: 0.8,
    },
    {
      id: "mock-a4",
      role: "agent",
      text: "No problem, I'll record that as unknown. Are there any plans to add more chargers?",
      pause: 0.6,
    },
    { id: "mock-p4", role: "participant", text: "Yes, we're adding another six next year.", pause: 0.8 },
    {
      id: "mock-a5",
      role: "agent",
      text: "Thank you. So that's six chargers today, access unknown, and six more planned for next year. That's everything I needed. Have a great day!",
      pause: 0.6,
    },
  ],
  declined: [
    { id: "mock-a1", role: "agent", text: CONSENT, pause: 0.6 },
    { id: "mock-d1", role: "participant", text: "Sorry, I'd rather not. Please take us off the list.", pause: 0.8 },
    { id: "mock-d2", role: "agent", text: "Of course, no problem at all. Thank you for your time, goodbye.", pause: 0.6 },
  ],
  disconnect: [
    { id: "mock-a1", role: "agent", text: CONSENT, pause: 0.6 },
    { id: "mock-p1", role: "participant", text: "Sure, go ahead.", pause: 0.7 },
    { id: "mock-a2", role: "agent", text: "Thanks. Does this property currently have EV charging stations?", pause: 0.6 },
    { id: "mock-p2", role: "participant", text: "Yes, we currently have six.", pause: 0.8 },
    { id: "mock-a3", role: "agent", text: "Got it, six chargers. Are they open to the public, or only", pause: 0.6 },
    // the connection drops here
  ],
  no_answer: [
    { id: "mock-a1", role: "agent", text: CONSENT, pause: 0.6 },
    { id: "mock-n1", role: "agent", text: "Hello? I can't hear anything, so I'll end the call here. Goodbye.", pause: 2.5 },
  ],
};

export interface MockAnnotation {
  text: string;
  values?: { field: string; value: boolean | number | string; confidence: number }[];
  unknown?: { field: string; reason: string }[];
  declined?: boolean;
}

/** Hand-written ground truth for the scripted lines above (mock extractor only). */
export const MOCK_ANNOTATIONS: Record<string, MockAnnotation> = {
  "mock-p2": {
    text: "Yes, we currently have six.",
    values: [
      { field: "ev_chargers_present", value: true, confidence: 0.95 },
      { field: "current_charger_count", value: 6, confidence: 0.9 },
    ],
  },
  "mock-p3": {
    text: "Honestly, I'm not sure. I'd have to check with the garage operator.",
    unknown: [{ field: "charger_accessibility", reason: "Participant did not know (would need to check with the garage operator)." }],
  },
  "mock-p4": {
    text: "Yes, we're adding another six next year.",
    values: [
      { field: "expansion_planned", value: true, confidence: 0.9 },
      { field: "additional_chargers_planned", value: 6, confidence: 0.85 },
      { field: "expansion_timeline", value: "next year", confidence: 0.8 },
    ],
  },
  "mock-d1": {
    text: "Sorry, I'd rather not. Please take us off the list.",
    declined: true,
  },
};
