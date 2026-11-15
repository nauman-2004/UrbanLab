# `cartesia/`: UrbanLab voice-research module

This is UrbanLab's **primary-evidence voice layer**. When the research agent finds a fact that no digital source can provide (for example "how many EV chargers does this building have?"), this module runs a short, **human-approved** voice interview through Cartesia. It turns the conversation into structured, provenance-tagged evidence.

- Cartesia is the voice layer, **not** the reasoning engine.
- The module is **study-agnostic.** EV readiness is only the mock test case.
- It's **self-contained.** It has its own package and its own dev demo, and doesn't depend on `frontend/`, `backend/`, CoStar, Vexcel, Matterport or Gemini.

```
UrbanLab (dashboard / backend)
   │  ResearchContext            (property, question, missing fields)
   ▼
ApprovalGate ──approve──► useCartesiaVoice ──► VoiceTransport
                               │                 ├─ CartesiaVoiceTransport  (LIVE: browser ⇄ Cartesia agent)
                               │                 └─ MockVoiceTransport      (MOCK: scripted, offline)
                               ▼
                          transcript ──► EvidenceExtractor ──► validateExtraction
                               │          ├─ MockEvidenceExtractor   (scripted, labelled mock)
                               │          └─ RemoteEvidenceExtractor (→ Gemini / backend, later)
                               ▼
   VoiceResearchResult + VoiceEvents   ──►  host accepts  ──►  EVIDENCE_ADDED  ──►  dataset / map / charts
```

The module never touches the map, the research table, the charts or CoStar data. It returns results and emits events, and the host decides what to do with them.

## Quick start

```bash
cd cartesia
npm install            # .npmrc sets legacy-peer-deps (works around an npm resolver crash with vitest 5's optional peers)
npm run dev            # http://localhost:3100/dev/cartesia   (mock mode by default)
```

### Mock mode (default; the hackathon fallback)

Mock mode needs no key, no network and no microphone. A deterministic scripted interview drives the **same UI and controller** as live mode.

**Flow:** mock evidence gap → approval → simulated session → live transcript → evidence extraction → accept → the property record changes from `? Missing` to `6 [Cartesia]`.

**Scenario picker** (in the header, or via `?scenario=…`):

| Scenario | What it does |
|---|---|
| `happy` | Successful interview; accessibility stays unknown |
| `declined` | Participant refuses consent; nothing is collected |
| `disconnect` | Call drops midway; partial evidence |
| `no_answer` | Agent speaks, nobody answers |
| `microphone_denied` | Browser permission refused |
| `auth_failed` | Server could not mint a session |
| `extraction_failed` | Transcript fine, extractor throws |

Add `?mode=mock` to force mock mode even when live mode is configured.

### Live mode

1. **Create an API key** in your Cartesia account.
2. **Create a voice agent** in the Cartesia dashboard and copy its **agent ID**. Any base configuration works: UrbanLab overrides its instructions and first message for each session (see *System prompt*).
3. **Add these to the repo-root `.env`** (the shared UrbanLab convention; `cartesia/.env.local` also works). Both files are git-ignored.
   ```bash
   CARTESIA_DEMO_MODE=live
   CARTESIA_API_KEY=...        # server-side only
   CARTESIA_AGENT_ID=...
   ```
4. **Restart** with `npm run dev`, open http://localhost:3100/dev/cartesia, pick **LIVE**, approve, and allow the microphone. `localhost` counts as a secure context, so the microphone works there.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `CARTESIA_DEMO_MODE` | no | `mock` (default) or `live` |
| `CARTESIA_API_KEY` | live only | **Server-only.** Used only by `POST /api/cartesia/session` |
| `CARTESIA_AGENT_ID` | live only | The Cartesia agent to talk to |
| `CARTESIA_API_VERSION` | no | Defaults to `2026-08-14` |

The server **refuses to run** if any `NEXT_PUBLIC_*CARTESIA*` variable exists. A variable with that prefix would be bundled into the browser.

## Security model

- **The browser never sees the API key.**
  - The page asks our same-origin route `POST /api/cartesia/session`.
  - That route calls Cartesia's `POST /v1/agents/websocket/{agent_id}/sessions` with `X-API-Key`.
  - It returns only `{ url, token, expiresAt, callId }`. The token is single-use and expires after about 4 minutes.
  - The browser then connects to `wss://…?cartesia_version=2026-08-14&access_token=<token>`, following Cartesia's documented browser flow.
- **Study instructions are trusted server-side overrides** (`config_overrides.instructions` / `initial_message`). The browser can't replace them.
- **The session route** rejects cross-origin requests, validates the incoming `ResearchContext`, and responds with `Cache-Control: no-store`.
- **`knownContext` never leaves the host.** That's the field that may hold CoStar sponsor data. Only these reach Cartesia:
  - property name
  - research question
  - participant role
  - the missing-field labels and descriptions
- **Logs** record milestones only (`VOICE SESSION STARTED`, `TRANSCRIPT RECEIVED`, `EVIDENCE EXTRACTED`, …). Anything that looks like a key or token is redacted, and tokens and audio are never logged.
- **Nothing connects before approval.** The controller won't create a transport (no microphone and no Cartesia) without a `VoiceApproval` that matches the loaded context. **Cancel** guarantees no connection.
- **`npm run check:bundle`** scans the built client assets for the key value, the key's variable name and the server-only endpoint. See *Testing* for how to run it.

## Contracts

### `ResearchContext` (IN), `src/types/index.ts`

```ts
{
  studyId, propertyId, propertyName?, researchQuestion, participantRole?,
  missingEvidence: [{ key, label, description?, type: "boolean"|"integer"|"number"|"text", required }],
  knownContext?   // host-only; never sent to Cartesia
}
```

`key` should be the dashboard's variable name (for example `ev_chargers_installed` on `main`), so evidence maps straight onto it.

### `VoiceResearchResult` (OUT)

```ts
{
  sessionId, studyId, propertyId, mode: "live"|"mock",
  status: "complete" | "partial" | "cancelled" | "failed",
  transcript: TranscriptEntry[],      // {id, role: agent|participant, text, timestamp, offsetSeconds, final}
  evidence: EvidenceValue[],          // {field, value, source:"cartesia", method:"interview", verification:"unverified",
                                      //  confidence, evidenceId, quote, transcriptEntryId, extractor}
  fields: FieldOutcome[],             // one per requested field: collected | unknown | missing; value null unless collected
  declined, error, extractor: {name, isMock}, startedAt, endedAt, durationSeconds
}
```

**What each status means:**
- `complete`: every **required** field was collected.
- `partial`: some evidence was collected, or an error happened after real evidence was gathered.
- `cancelled`: the participant declined.
- `failed`: nothing was collected and something went wrong.

**Evidence rules** (`validateExtraction`, applied to every extractor's output):
- A value must belong to a requested field and have the right type.
- It must quote a turn the **participant** actually said.
- A later correction replaces an earlier answer.
- Provenance is always forced to `source: "cartesia"`, `method: "interview"`, `verification: "unverified"`.
- "Don't know" is kept as `unknown`, never guessed.

### Events (`VoiceEventBus`)

| Event | When |
|---|---|
| `VOICE_SESSION_APPROVED` | A human approved this context |
| `VOICE_SESSION_CANCELLED` | Cancelled before starting (no connection made) |
| `VOICE_SESSION_STARTED` | Voice session live |
| `VOICE_TRANSCRIPT_UPDATED` | A turn was finalised |
| `VOICE_EVIDENCE_EXTRACTED` | Extractor finished (validated output) |
| `VOICE_SESSION_COMPLETED` | Result available (`complete`, `partial` or `cancelled`) |
| `VOICE_SESSION_FAILED` | Nothing collected; includes the error |
| `EVIDENCE_ADDED` | **Emitted by the host** through `acceptEvidence(bus, result)` once it accepts values |

**Mapping onto UrbanLab on `main`** (`src/adapters/urbanlab.ts`). This reuses `main`'s data model instead of adding a new one:
- `VOICE_SESSION_COMPLETED` → the `call_transcript` event, via `toUrbanLabCall(result, context)`. That produces `main`'s `Call` shape, with speaker `agent`/`contact` and a `t` in seconds.
- `EVIDENCE_ADDED` → one `cell_updated` event per field, via `toUrbanLabCells(result)`. That produces `main`'s `Cell` shape:
  - `source: "survey"`
  - booleans as 1/0
  - missing fields as `value: null, status: "missing"` with a reason
  - `evidence_ref` of the form `cartesia:<session> @ mm:ss: "<quote>"`, prefixed `STUB ` in mock mode (like `main`'s telephony stub)

## System prompt

The prompt lives in `src/prompt/interviewer.ts`.

- **`INTERVIEWER_RULES`** is fixed behaviour:
  - consent first; one question at a time
  - never invent; preserve unknowns
  - don't re-ask; recognise several facts in one answer
  - clarify ambiguous numbers
  - never claim to have queried CoStar, Vexcel or Matterport, or to have run statistics
  - no sensitive personal information; stop politely if declined; keep it short
- **`buildInterviewerInstructions(context)`** adds the study-specific part: the question, the property, the participant role and the fields to collect. Host text is sanitised (no braces, length caps). EV charging is not hard-coded anywhere outside `src/mock/`.

## How Gemini plugs in

Gemini isn't integrated yet. On `main`, transcript extraction currently runs in the backend through OpenRouter (`backend/llm.py → extract_survey_answers`). The boundary for either is `EvidenceExtractor`:

```ts
interface EvidenceExtractor {
  readonly name: string; readonly isMock: boolean;
  extract(context, transcript, sessionId): Promise<{ values: EvidenceValue[]; unknown: UnknownEvidence[]; declined?: boolean }>;
}
```

1. **Add a server route** (for example `src/app/api/cartesia/extract/route.ts`) that calls Gemini with `GEMINI_API_KEY`, server-side only. Use a structured-output schema of `{ field, value, confidence, quote, transcriptEntryId }` and the rule "only what the participant said; null if unclear".
2. **Pass `new RemoteEvidenceExtractor("/api/cartesia/extract", "gemini")`** to `useCartesiaVoice({ extractor })`. It already strips `knownContext` before sending.
3. **Nothing else changes.** `validateExtraction` still rejects anything that doesn't quote a real participant turn.

The alternative is to point `RemoteEvidenceExtractor` at a backend endpoint that wraps `extract_survey_answers`.

## Dashboard integration (later; not done on this branch)

1. **Dashboard detects a gap** (`gap_detected`, `source: "survey"`) and builds a `ResearchContext`:
   - `propertyId` = `building_id`
   - `missingEvidence` from the plan's survey variables (`name` → `key`, `label`, and `type` mapped as int→integer, bool→boolean)
   - CoStar fields go only in `knownContext`, if at all
2. **Open the approval UI.** Render `<ApprovalGate>`, or reuse `main`'s `ApprovalModal`, and call `voice.load(context)`.
3. **On approve:** `const a = voice.approve(); voice.startSession(a)`.
4. **During the call:** render `<VoiceResearchPanel voice={voice} context={context} />`. The transcript updates live.
5. **When it ends:** on `VOICE_SESSION_COMPLETED`, show `<EvidenceExtraction result>` for review.
6. **On accept:** call `acceptEvidence(voice.bus, result)`, then forward `toUrbanLabCells(result)` as `cell_updated` and `toUrbanLabCall(result, context)` as `call_transcript`, or POST them to the backend.
7. **The rest stays in the dashboard.** Its reducer updates the dataset, and the map and charts redraw. The module itself does nothing further.

**Moving the code:** copy or import `src/{types,services,hooks,components,prompt,adapters}` into `frontend/src/voice/`. Move `src/server` and the `api/cartesia/session` route into `frontend/src/app/api/`. Add the three env vars to the root `.env.example`.

**Backend alternative:** `main`'s `backend/telephony.py` is a stub for phone calls through Twilio and Cartesia. This module is the **browser** path. Both can produce the same `Call` and `Cell` shapes.

## Testing

```bash
npm test               # vitest: 60 tests (approval gate, cancel, live protocol with a fake socket,
                       #   transcript, end, mock extraction, result building, null-missing,
                       #   error states, mock end-to-end, server route, key never returned/logged)
npm run typecheck
npm run lint
CARTESIA_DEMO_MODE=live CARTESIA_API_KEY=sk_car_BUNDLE_SENTINEL CARTESIA_AGENT_ID=agent_sentinel npm run build
CARTESIA_API_KEY=sk_car_BUNDLE_SENTINEL npm run check:bundle
```

## Known limitations

- **Live mode is implemented from Cartesia's documented v1 agent protocol, but it hasn't been run against a real agent yet.** The automated tests use a fake WebSocket, a fake microphone and a fake server. Run a live smoke test before demoing.
- **No real extractor yet.** In live mode the mock extractor finds nothing (by design). Real-call evidence needs the Gemini or backend extractor (see above). Until then, live results correctly show every field as `? Missing`.
- **Audio is basic.** The microphone is resampled to 16 kHz with linear interpolation, and agent audio plays as `pcm_16000`. There's no noise gate beyond the browser's own echo cancellation and noise suppression.
- **`config_overrides` must be allowed by the agent.** The docs don't say whether agents need overrides enabled. A 400 from session creation points at the agent's configuration.
- **The demo isn't for production.** `/dev/cartesia` has no authentication, so don't deploy it publicly with a real key.

## Troubleshooting

| Symptom | Fix |
|---|---|
| LIVE button disabled | Set `CARTESIA_DEMO_MODE=live`, `CARTESIA_API_KEY` and `CARTESIA_AGENT_ID`, then restart |
| "Microphone permission was denied" | Allow the microphone for `localhost:3100` in the browser's site settings |
| "rejected the API key (401)" | Wrong or revoked key |
| "agent not found (404)" | Wrong `CARTESIA_AGENT_ID` |
| "concurrency limit (429)" | Wait, or switch to MOCK |
| "did not confirm the session in time" | Network or firewall blocking `wss://api.cartesia.ai`; switch to MOCK |
| `npm install` crashes with `edgesOut` | Keep `cartesia/.npmrc` (`legacy-peer-deps=true`) |
