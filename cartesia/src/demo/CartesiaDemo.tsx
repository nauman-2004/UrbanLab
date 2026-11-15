"use client";

/**
 * Standalone host for the voice module. It plays the role the UrbanLab
 * dashboard will play later: it owns the property record, builds the
 * ResearchContext, and accepts evidence. The module only returns results/events.
 */
import { useEffect, useMemo, useState } from "react";
import { toUrbanLabCells } from "../adapters/urbanlab";
import { ApprovalGate } from "../components/ApprovalGate";
import { EvidenceExtraction } from "../components/EvidenceExtraction";
import { VoiceResearchPanel } from "../components/VoiceResearchPanel";
import { VoiceTranscript } from "../components/VoiceTranscript";
import { CartesiaTag, Card, formatValue, MissingTag, ModeBadge } from "../components/ui";
import { useCartesiaVoice } from "../hooks/useCartesiaVoice";
import { DEMO_CONTEXT } from "../mock/demo-context";
import { MOCK_SCENARIOS, type MockScenario } from "../mock/demo-transcript";
import { acceptEvidence } from "../services/events";
import type { EvidenceValue, VoiceEvent, VoiceMode } from "../types";

interface DemoProps {
  initialMode: VoiceMode;
  liveAvailable: boolean;
  liveUnavailableReason: string | null;
  initialScenario: MockScenario;
}

export function CartesiaDemo({ initialMode, liveAvailable, liveUnavailableReason, initialScenario }: DemoProps) {
  const [mode, setMode] = useState<VoiceMode>(initialMode);
  const [scenario, setScenario] = useState<MockScenario>(initialScenario);
  const [run, setRun] = useState(0);
  // Host-owned dataset for HOU-018. Only EVIDENCE_ADDED changes it.
  const [record, setRecord] = useState<Record<string, EvidenceValue>>({});

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">UrbanLab</span>
            <span className="text-dim">/</span>
            <span className="text-soft">Cartesia voice research</span>
            <span className="rounded border border-line2 px-1.5 py-px font-mono text-[10px] text-muted">DEV DEMO</span>
          </div>
          <p className="mt-0.5 text-xs text-dim">Standalone module test. No CoStar, Vexcel, Matterport or dashboard involved.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex overflow-hidden rounded-lg border border-line2" role="group" aria-label="Mode">
            {(["mock", "live"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={m === "live" && !liveAvailable}
                title={m === "live" && !liveAvailable ? (liveUnavailableReason ?? undefined) : undefined}
                onClick={() => {
                  setMode(m);
                  setRun((r) => r + 1);
                }}
                className={`px-3 py-1.5 font-mono text-xs uppercase ${mode === m ? "bg-accent text-white" : "text-soft hover:bg-panel2"} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {m}
              </button>
            ))}
          </div>
          {mode === "mock" && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Scenario
              <select
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value as MockScenario);
                  setRun((r) => r + 1);
                }}
                className="rounded-md border border-line2 bg-panel px-2 py-1 text-sm text-ink"
              >
                {MOCK_SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              setRecord({});
              setRun((r) => r + 1);
            }}
            className="rounded-lg border border-line2 px-3 py-1.5 text-xs text-soft hover:bg-panel2"
          >
            Reset demo
          </button>
        </div>
      </header>
      {!liveAvailable && (
        <p className="mt-3 text-xs text-dim">
          Live mode unavailable: {liveUnavailableReason} See <span className="font-mono">cartesia/README.md</span>.
        </p>
      )}

      {/* key: a new mode/scenario/reset gets a fresh, unapproved session */}
      <DemoFlow key={`${mode}-${scenario}-${run}`} mode={mode} scenario={scenario} record={record} setRecord={setRecord} />
    </div>
  );
}

const STEPS = ["Evidence gap", "Approval", "Voice session", "Extraction", "Result"] as const;

function DemoFlow({
  mode,
  scenario,
  record,
  setRecord,
}: {
  mode: VoiceMode;
  scenario: MockScenario;
  record: Record<string, EvidenceValue>;
  setRecord: (r: Record<string, EvidenceValue>) => void;
}) {
  const voice = useCartesiaVoice({ mode, scenario });
  const [events, setEvents] = useState<VoiceEvent[]>([]);
  const [accepted, setAccepted] = useState(false);
  const { state } = voice;
  const context = DEMO_CONTEXT;

  // Host: create the ResearchContext from the detected gap (here: the mock context).
  useEffect(() => {
    voice.load(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Host: listen to module events. EVIDENCE_ADDED is the only thing that changes the record.
  useEffect(
    () =>
      voice.bus.subscribe((e) => {
        setEvents((prev) => [...prev, e].slice(-60));
        if (e.type === "EVIDENCE_ADDED") {
          const next = { ...record };
          for (const ev of e.evidence) next[ev.field] = ev;
          setRecord(next);
        }
      }),
    [voice.bus, record, setRecord],
  );

  const step = (() => {
    switch (state.status) {
      case "idle":
        return 0;
      case "awaiting_approval":
      case "cancelled":
        return 1;
      case "requesting_microphone":
      case "connecting":
      case "live":
      case "ending":
        return 2;
      case "extracting":
        return 3;
      default:
        return 4;
    }
  })();

  const cells = useMemo(() => (state.result ? toUrbanLabCells(state.result) : null), [state.result]);
  const highlight = state.result?.evidence.map((e) => e.transcriptEntryId) ?? [];
  const showPanel = step === 2 || step === 3;

  return (
    <>
      <ol className="mt-4 flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
              i === step ? "border-accent bg-accent/15 text-ink" : i < step ? "border-line2 text-soft" : "border-line text-dim"
            }`}
          >
            <span className="font-mono">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      <div className="mt-4 grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)_20rem]">
        {/* LEFT: host dataset */}
        <Card title="Property record · host dataset">
          <div className="p-4">
            <div className="font-medium">{context.propertyName}</div>
            <div className="font-mono text-xs text-dim">{context.propertyId}</div>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-well">
              {context.missingEvidence.map((f) => {
                const ev = record[f.key];
                return (
                  <li key={f.key} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${ev ? "animate-flash" : ""}`} data-field={f.key}>
                    <span className="text-soft">{f.label}</span>
                    {ev ? (
                      <span className="flex items-center gap-1.5">
                        <span className="unverified-ring rounded px-1.5 font-mono font-semibold">{formatValue(ev.value)}</span>
                        <CartesiaTag compact />
                      </span>
                    ) : (
                      <MissingTag />
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-dim">
              Owned by the host. The voice module never writes here; values appear only after the host accepts them
              (<span className="font-mono">EVIDENCE_ADDED</span>).
            </p>
          </div>
        </Card>

        {/* CENTER: the flow */}
        <div className="space-y-4">
          {step <= 1 && state.status !== "cancelled" && (
            <ApprovalGate
              context={context}
              mode={mode}
              notice={state.error?.kind === "approval_required" ? state.error.message : null}
              onCancel={() => voice.cancel()}
              onApprove={() => {
                const approval = voice.approve();
                void voice.startSession(approval);
              }}
            />
          )}

          {state.status === "cancelled" && (
            <Card title="Primary evidence collection">
              <div className="space-y-3 p-4 text-sm">
                <p className="text-soft">Cancelled before starting. No microphone was opened and no Cartesia connection was made.</p>
                <button type="button" onClick={() => voice.reset()} className="rounded-lg border border-line2 px-3 py-1.5 text-soft hover:bg-panel2">
                  Back to approval
                </button>
              </div>
            </Card>
          )}

          {showPanel && <VoiceResearchPanel voice={voice} context={context} />}

          {step === 4 && state.result && (
            <>
              <EvidenceExtraction
                result={state.result}
                actions={
                  state.result.evidence.length > 0 ? (
                    accepted ? (
                      <span className="text-sm text-voice">Accepted into the host dataset ✓</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          acceptEvidence(voice.bus, state.result!);
                          setAccepted(true);
                        }}
                        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent2"
                      >
                        Accept {state.result.evidence.length} value{state.result.evidence.length === 1 ? "" : "s"} into dataset
                      </button>
                    )
                  ) : undefined
                }
              />
              {state.result.transcript.length > 0 && (
                <Card title="Interview transcript">
                  <div className="scrollbar-thin max-h-80 overflow-y-auto px-4 py-3">
                    <VoiceTranscript entries={state.result.transcript} participantLabel={context.participantRole} highlightIds={highlight} />
                  </div>
                </Card>
              )}
            </>
          )}

          {step === 4 && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => voice.reset()} className="rounded-lg border border-line2 px-3 py-1.5 text-sm text-soft hover:bg-panel2">
                Run another interview
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: what the module emits */}
        <div className="space-y-4">
          <Card title="Module events" right={<ModeBadge mode={mode} />}>
            <ol className="scrollbar-thin max-h-[26rem] space-y-1 overflow-y-auto p-3 font-mono text-[11px]">
              {events.length === 0 && <li className="text-dim">No events yet. Nothing connects before approval.</li>}
              {events.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-dim">{e.at.slice(11, 19)}</span>
                  <span className={e.type === "VOICE_SESSION_FAILED" ? "text-gap" : e.type === "EVIDENCE_ADDED" ? "text-voice" : "text-soft"}>
                    {e.type}
                    {e.type === "VOICE_TRANSCRIPT_UPDATED" && <span className="text-dim"> {e.entry.role}</span>}
                    {e.type === "VOICE_EVIDENCE_EXTRACTED" && <span className="text-dim"> {e.output.values.length} values</span>}
                    {e.type === "VOICE_SESSION_COMPLETED" && <span className="text-dim"> {e.result.status}</span>}
                    {e.type === "VOICE_SESSION_FAILED" && <span className="text-dim"> {e.error.kind}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          {cells && (
            <Card title="UrbanLab payload (cell_updated)">
              <pre className="scrollbar-thin max-h-72 overflow-auto p-3 font-mono text-[10px] leading-relaxed text-muted">
                {JSON.stringify(cells.map(({ variable, value, source, status, evidence_ref }) => ({ variable, value, source, status, evidence_ref })), null, 1)}
              </pre>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
