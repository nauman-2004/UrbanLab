/**
 * Evidence extraction contract + result building.
 *
 * - `EvidenceExtractor` (types) is the plug-in boundary. Gemini, or UrbanLab's
 *   existing backend extractor (backend/llm.py `extract_survey_answers`), plugs
 *   in behind it. See README "How Gemini plugs in".
 * - `MockEvidenceExtractor` is NOT AI: it returns hand-written annotations for
 *   the scripted demo lines, and nothing for any other transcript.
 * - `validateExtraction` is applied to EVERY extractor's output, so no extractor
 *   can invent evidence: each value must match a requested field, have the right
 *   type, and quote a real participant turn.
 */
import { MOCK_ANNOTATIONS } from "../mock/demo-transcript";
import type {
  EvidenceExtractor,
  EvidenceValue,
  ExtractionOutput,
  FieldOutcome,
  MissingEvidenceField,
  ResearchContext,
  TranscriptEntry,
  UnknownEvidence,
  VoiceError,
  VoiceMode,
  VoiceResearchResult,
  VoiceResearchStatus,
} from "../types";

export function evidenceId(sessionId: string, field: string): string {
  return `ev-${sessionId}-${field}`;
}

// ----------------------------------------------------------- extractors ----

/** Scripted demo extractor. Clearly mock: recognises only the exact scripted lines. */
export class MockEvidenceExtractor implements EvidenceExtractor {
  readonly name = "mock-scripted";
  readonly isMock = true;

  constructor(private readonly options: { fail?: boolean } = {}) {}

  async extract(_context: ResearchContext, transcript: TranscriptEntry[], sessionId: string): Promise<ExtractionOutput> {
    if (this.options.fail) throw new Error("Mock extractor configured to fail (extraction_failed scenario).");
    const values: EvidenceValue[] = [];
    const unknown: UnknownEvidence[] = [];
    let declined = false;
    for (const entry of transcript) {
      if (entry.role !== "participant") continue;
      const note = MOCK_ANNOTATIONS[entry.id];
      if (!note || note.text !== entry.text) continue; // only the exact scripted line counts
      if (note.declined) declined = true;
      for (const v of note.values ?? []) {
        values.push({
          field: v.field,
          value: v.value,
          source: "cartesia",
          method: "interview",
          verification: "unverified",
          confidence: v.confidence,
          evidenceId: evidenceId(sessionId, v.field),
          quote: entry.text,
          transcriptEntryId: entry.id,
          extractor: this.name,
        });
      }
      for (const u of note.unknown ?? []) unknown.push({ ...u, quote: entry.text, transcriptEntryId: entry.id });
    }
    return { values, unknown, declined };
  }
}

/**
 * Adapter for a server-side extractor (future Gemini route, or the UrbanLab backend).
 * POSTs `{ context, transcript, sessionId }` and expects an `ExtractionOutput` JSON body.
 * The browser never holds the LLM key; the endpoint does.
 */
export class RemoteEvidenceExtractor implements EvidenceExtractor {
  readonly isMock = false;

  constructor(
    private readonly endpoint: string,
    readonly name = "remote",
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async extract(context: ResearchContext, transcript: TranscriptEntry[], sessionId: string): Promise<ExtractionOutput> {
    const { knownContext: _hostOnly, ...safeContext } = context; // never ship host-only context
    void _hostOnly;
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: safeContext, transcript, sessionId }),
    });
    if (!res.ok) throw new Error(`Extractor endpoint returned ${res.status}`);
    const body = (await res.json()) as Partial<ExtractionOutput>;
    return {
      values: Array.isArray(body.values) ? body.values : [],
      unknown: Array.isArray(body.unknown) ? body.unknown : [],
      declined: body.declined === true,
    };
  }
}

// ----------------------------------------------------------- validation ----

function coerce(field: MissingEvidenceField, value: unknown): EvidenceValue["value"] | null {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? value : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "text":
      return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}

/**
 * Keeps only trustworthy evidence: requested field, correct type, a non-empty
 * quote, and a transcript entry that exists and was spoken by the participant.
 * Later answers replace earlier ones for the same field (participants correct themselves).
 */
export function validateExtraction(
  context: ResearchContext,
  transcript: TranscriptEntry[],
  output: ExtractionOutput,
): ExtractionOutput {
  const fields = new Map(context.missingEvidence.map((f) => [f.key, f]));
  const turns = new Map(transcript.map((t, i) => [t.id, { t, i }]));
  const best = new Map<string, { v: EvidenceValue; order: number }>();

  for (const v of output.values) {
    const field = fields.get(v.field);
    const turn = turns.get(v.transcriptEntryId);
    if (!field || !turn || turn.t.role !== "participant" || !v.quote?.trim()) continue;
    const value = coerce(field, v.value);
    if (value === null) continue;
    const clean: EvidenceValue = {
      ...v,
      value,
      source: "cartesia",
      method: "interview",
      verification: "unverified",
      confidence: typeof v.confidence === "number" ? Math.min(1, Math.max(0, v.confidence)) : null,
    };
    const prev = best.get(v.field);
    if (!prev || turn.i >= prev.order) best.set(v.field, { v: clean, order: turn.i });
  }

  const values = [...best.values()].map((b) => b.v);
  const collected = new Set(values.map((v) => v.field));
  const unknown = output.unknown.filter((u) => fields.has(u.field) && !collected.has(u.field));
  return { values: output.declined ? [] : values, unknown: output.declined ? [] : unknown, declined: output.declined === true };
}

// --------------------------------------------------------------- result ----

export interface BuildResultInput {
  context: ResearchContext;
  sessionId: string;
  mode: VoiceMode;
  transcript: TranscriptEntry[];
  extraction: ExtractionOutput | null;
  extractor: EvidenceExtractor | null;
  startedAt: string | null;
  endedAt?: string;
  error?: VoiceError | null;
}

export function buildResult(input: BuildResultInput): VoiceResearchResult {
  const { context, transcript, extraction, extractor } = input;
  const error = input.error ?? null;
  const endedAt = input.endedAt ?? new Date().toISOString();
  const evidence = extraction?.values ?? [];
  const declined = extraction?.declined === true;
  const byField = new Map(evidence.map((e) => [e.field, e]));
  const unknownByField = new Map((extraction?.unknown ?? []).map((u) => [u.field, u]));
  const participantSpoke = transcript.some((t) => t.role === "participant" && t.text.trim());

  const missingReason = (): string => {
    if (declined) return "Participant declined to take part.";
    if (!participantSpoke) return "No participant answer in the transcript.";
    if (!extraction) return error ? `Not extracted: ${error.message}` : "Not extracted.";
    if (extractor?.isMock)
      return "Not extracted: the mock extractor only recognises the scripted demo transcript. Plug in a real extractor.";
    return "Not answered in the interview.";
  };

  const fields: FieldOutcome[] = context.missingEvidence.map((f) => {
    const ev = byField.get(f.key);
    if (ev) return { key: f.key, label: f.label, required: f.required, status: "collected", value: ev.value, evidenceId: ev.evidenceId, reason: null };
    const unk = unknownByField.get(f.key);
    if (unk) return { key: f.key, label: f.label, required: f.required, status: "unknown", value: null, evidenceId: null, reason: unk.reason };
    return { key: f.key, label: f.label, required: f.required, status: "missing", value: null, evidenceId: null, reason: missingReason() };
  });

  let status: VoiceResearchStatus;
  if (declined) status = "cancelled";
  else if (error && evidence.length === 0) status = "failed";
  else if (error || fields.some((f) => f.required && f.status !== "collected")) status = "partial";
  else status = "complete";

  const start = input.startedAt ? Date.parse(input.startedAt) : NaN;
  const durationSeconds = Number.isFinite(start) ? Math.max(0, Math.round((Date.parse(endedAt) - start) / 1000)) : 0;

  return {
    sessionId: input.sessionId,
    studyId: context.studyId,
    propertyId: context.propertyId,
    mode: input.mode,
    status,
    transcript,
    evidence,
    fields,
    startedAt: input.startedAt,
    endedAt,
    durationSeconds,
    extractor: extractor ? { name: extractor.name, isMock: extractor.isMock } : null,
    error,
    declined,
  };
}
