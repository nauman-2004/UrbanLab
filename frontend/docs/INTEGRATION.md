# UrbanLab — Frontend ⇄ Agent Backend

The frontend never calls CoStar, Vexcel, the LLM or telephony directly. The **agent backend**
(`backend/`, LangChain Deep Agents) runs the study and streams its progress as events; the UI is a pure
function of that stream. The backend is the source of truth: the plan's variables, the sample, every
value and its provenance all arrive as events. Nothing about the study is hard-coded in the UI.

Types: [`src/lib/events.ts`](../src/lib/events.ts) (events) and [`src/lib/types.ts`](../src/lib/types.ts) (domain),
mirroring `backend/events.py`, `dataset.py`, `tools.py` and `analysis.py`.

## Modes

Set in the **repo-root `.env`** (loaded by `next.config.ts`; `frontend/.env.local` overrides it):

| Variable | Values |
|---|---|
| `NEXT_PUBLIC_STUDY_SOURCE` | `replay` (default): plays a recorded backend run, no backend needed · `live`: talks to the backend |
| `NEXT_PUBLIC_API_BASE` | backend URL for live mode, default `http://localhost:8000` |

The backend must allow the frontend origin in `CORS_ORIGINS`. Never put API keys in `NEXT_PUBLIC_*`.

`npm run dev` (in `frontend/`) sets these for you: it starts the backend, waits for `/health`, then starts the UI in
live mode. `npm run dev:fake` uses the scripted test model and `npm run dev:demo` runs replay mode only.
To run the pieces separately:

```bash
cd backend && uv run uvicorn main:app --port 8000      # or tests.fake_server:app (no API key / quota)
cd frontend && npm run dev:web                          # UI only, mode from .env
```

## Transport (`src/lib/source/live.ts`)

| Method | Path | Body → response |
|---|---|---|
| `POST` | `/studies` | `{question}` → `{study_id}` |
| `GET` | `/studies/{id}/events` | SSE. `event:` = type, `data:` = event JSON. Replays history on (re)connect; the reducer drops duplicates by `seq`. Ends after `study_completed` / `study_failed`. |
| `POST` | `/studies/{id}/approve` | `{action_id, approved, feedback?}` → 202. The agent resumes once every approval in the pause is answered. |
| `GET` | `/tiles/{file}` | the aerial tile a building was measured from |
| `GET` | `/studies/{id}/dataset` | full snapshot (not used by the UI; handy for debugging) |

## Events

Every event is `{type, study_id, seq, ts, data}`:

| type | data | UI |
|---|---|---|
| `study_started` | `{question}` | question bar |
| `step_started` / `step_done` | `{step, step_id, description \| summary}` | stepper, Research Plan subagents, activity log |
| `tool_called` | `{step, name, args}` (subagent tool calls) | activity log |
| `plan_ready` | `{plan: {hypothesis, variables:[{name, source, type, label}], sample:{city, property_type, n}}}` | Research Plan; dataset columns |
| `building_added` | `{building: {building_id, costar_id, name, address, city, property_type, lat, lng}}` | map, table rows |
| `building_updated` | `{building_id, aerial_url}` | aerial tile in the building panel |
| `cell_updated` | `{cell: {building_id, variable, value, source, confidence, evidence_ref, status, reason, note, updated_at}}` | table, building panel |
| `gap_detected` | `{building_id, variable, source, reason}` | gap banner, map |
| `approval_required` | `{action_id, kind: "plan"\|"survey", tool, args, description, allowed_decisions, round, round_size}` | approval dialog |
| `call_transcript` | `{building_id, call_id, contact_role, consent, transcript:[{speaker, text, t}], duration_s, stub}` | call card + transcript drawer |
| `findings_ready` | `{findings[], effects[], by_decade[], chart_spec, limitations[], era_cutoff, n_buildings}` | Findings page |
| `study_completed` / `study_failed` | `{summary}` / `{error}` | summary, status |

Rules the UI relies on:

1. **Statistics are server-side.** `analysis.py` computes every number from filled cells; the Findings page renders them as-is.
2. **Missing is explicit.** A cell with `status: "missing"` always has a `reason`; `"Not yet collected."` is the placeholder before a tool runs.
3. **Survey values are self-reported.** They're shown as unverified, with the quote from `evidence_ref` (`call-… @ mm:ss: "…"`).
   `evidence_ref` starting with `STUB` means the telephony stub produced it.
4. **Approvals come in rounds.** All `approval_required` events from one pause share `round`; the dialog shows them together
   (one plan review, or one card per phone call that can be approved or declined individually).

## Replay mode

`src/lib/replay/recorded-study.json` is a recorded event stream, played by `src/lib/source/replay.ts` with
compressed timing; it pauses at each approval like the real agent. Re-record it after changing the backend's events:

```bash
cd backend
uv run uvicorn tests.fake_server:app --port 8000   # or main:app for a run with the live models (uses API quota)
uv run python scripts/record_replay.py
cp data/tiles/*.png ../frontend/public/replay/tiles/   # tiles the replay shows
```
