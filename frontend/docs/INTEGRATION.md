# UrbanLab — Backend Integration Contract

The frontend never calls CoStar, Vexcel, Matterport, the LLM or Cartesia directly.
The **agent backend** (LangChain Deep Agents) calls those services and streams **`StudyEvent`s** to the UI.
The UI sends back **`StudyCommand`s** for human-in-the-loop actions.

Source of truth for the types: [`src/lib/events.ts`](../src/lib/events.ts) and [`src/lib/types.ts`](../src/lib/types.ts).
The demo replay in [`src/lib/replay/script.ts`](../src/lib/replay/script.ts) is a complete, working example of a valid event stream.

## Transport

| Method | Path | Body / response |
|---|---|---|
| `POST` | `/studies` | `{ "question": string }` → `{ "studyId": string }` |
| `GET` | `/studies/{id}/events` | `text/event-stream`; each `data:` line is one `StudyEvent` JSON object |
| `POST` | `/studies/{id}/commands` | one `StudyCommand` JSON object → `202 Accepted` |

Enable it with `NEXT_PUBLIC_STUDY_SOURCE=live` and `NEXT_PUBLIC_API_BASE=<url>` (see `src/lib/source/live.ts`).
Allow CORS from the frontend origin. Do **not** put API keys in `NEXT_PUBLIC_*` variables; they belong to the backend.

## Who emits what

| Integration | Backend responsibility | Events the UI expects |
|---|---|---|
| **LangChain Deep Agents** | Planner, `write_todos`, subagents, `interrupt_on` | `study.started`, `plan.updated`, `todos.updated` (full snapshot), `stage.changed`, `tool.called`, `subagent.started` / `subagent.finished`, `approval.requested`, `analysis.started`, `report.ready` |
| **CoStar** (SDK / MCP / OpenAPI) | Sample selection, building records, parking notes, contact role | `property.added` (`PropertyInfo` with real `lat`/`lng`, `costarId`, `contactRole`), `cell.filled` with `source: "costar"` for `yearBuilt`, `rbaSf`, `lotSf`, optionally `offsiteSpaces` / `garageStalls` (set `evidence.note` when inferred) |
| **Vexcel** | Ortho tile per building; segmentation by the vision LLM | `cell.filled` `surfaceSf`, `source: "vexcel"`, `evidence.confidence`; optional `PropertyInfo.aerialUrl` (the UI shows the real tile instead of the schematic) |
| **Matterport** | Count structured parking in the scan | `cell.filled` `garageStalls`, `source: "matterport"`, `evidence.ref` = scan id, `evidence.note` = levels; optional `PropertyInfo.matterportUrl` |
| **Gemini ⇄ Nemotron** | Vision segmentation, transcript extraction | Surface through `tool.called` / `subagent.started` with `tag: "gemini"` (or `"nemotron"`) and `interview.extracted` with `confidence` and `quoteT` |
| **Cartesia** | Voice call (TTS + STT), only after approval | `interview.started`, `interview.consent`, `interview.utterance`, `interview.question`, `interview.extracted`, `interview.ended` |

## Rules the backend must follow

1. **Gaps before calls.** Emit `gap.detected` for each value that can't be observed, then `approval.requested`. **Do not start any call until** a `{"type":"approval.respond","approved":true}` command arrives. On `approved:false`, emit no interviews and continue to analysis.
2. **Interview values are unverified.** Every `cell.filled` with `source: "interview"` must use `verification: "unverified"` and include `evidence.ref` (e.g. `"iv-01 @ 00:12"`) and `evidence.quote`. Only a `cell.verify` command (researcher-supplied evidence) or an independent document check may emit `cell.verified`.
3. **Consent first.** Emit `interview.consent` after the contact agrees, before any substantive question. If consent is refused, emit `interview.ended` and `gap.status: "declined"`.
4. **Stable ids.** `propertyId` (e.g. `"B-07"`) and `VariableKey`s must match across events.
5. **Statistics are client-side.** The UI computes medians, Spearman and Mann-Whitney from the dataset (`src/lib/analysis.ts`), so findings always match the visible data. The backend only signals `analysis.started` / `report.ready`.

## Commands the UI sends

```jsonc
{ "type": "approval.respond", "requestId": "ap-1", "approved": true }
{ "type": "interview.hangup", "interviewId": "iv-01" }
{ "type": "cell.verify", "propertyId": "B-01", "variable": "offsiteSpaces", "evidenceRef": "Parking lease agreement" }
```

## Minimal example stream

```text
data: {"type":"study.started","studyId":"s1","question":"Do older office buildings in Houston dedicate more land to surface parking?"}
data: {"type":"property.added","property":{"id":"B-01","costarId":"1084-221","name":"…","address":"…","propertyClass":"A","occupancyPct":84,"lat":29.7571,"lng":-95.3641}}
data: {"type":"cell.filled","propertyId":"B-01","variable":"yearBuilt","cell":{"value":1974,"source":"costar","verification":"observed","evidence":{"ref":"CoStar #1084-221"}}}
data: {"type":"gap.detected","gap":{"propertyId":"B-01","variable":"offsiteSpaces","reason":"Off-site parking contracts aren't visible in records, aerials, or 3D scans"}}
data: {"type":"approval.requested","request":{"id":"ap-1","title":"Approve 1 research interview","purpose":"…","targets":[{"propertyId":"B-01","contact":"Property manager"}],"questions":["…"]}}
```
