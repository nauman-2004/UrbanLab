# UrbanLab agent backend

A research question goes in. A LangChain **DeepAgents** "Principal Investigator" then:

1. plans the study (**human approval gate**),
2. pulls CoStar records,
3. measures parking from Vexcel aerial tiles with a vision model (Google Gemini),
4. reports what is missing and why,
5. runs the statistics.

Every value lands in a dataset with provenance, and progress streams over SSE.

Demo question: *"Do older office buildings in Houston dedicate more land to surface parking?"*

> **Placeholder data:** `data/costar_sample.csv` and `data/tiles/*.png` (schematic drawings) are **stubs**, used only when the CoStar kit / live Vexcel aren't configured (and by the tests). Values from them are labelled in the dataset (`costar_id` `SAMPLE-…`), and the analysis lists them as limitations. Don't present these numbers as findings.

## Run it

Easiest: `cd frontend && npm run dev` starts this backend and the UI together (see `frontend/README.md`).
To run the backend on its own:

```bash
cd backend
uv sync                                        # Python 3.11 venv + deps (uv installs 3.11 if needed)
uv run python scripts/make_sample_tiles.py     # only if data/tiles/ is empty
# put GOOGLE_API_KEY (and optionally DEMO_MODE=1) in the repo-root .env — see .env.example
uv run uvicorn main:app --port 8000
```

In a second terminal:

```bash
bash scripts/demo.sh                    # runs the demo question end to end, auto-approving the plan
AUTO_APPROVE=0 bash scripts/demo.sh     # answer y/n at the plan gate yourself
```

To run without an API key, use the scripted fake model. It drives the real graph, tools and interrupts:

```bash
uv run pytest -q                                      # offline end-to-end + unit tests
uv run uvicorn tests.fake_server:app --port 8000      # API with the fake model
```

### Demo mode

With `DEMO_MODE=1`, the first run calls CoStar and the vision model live and writes the outputs to `data/cache/`.

Later runs replay those cached outputs, paced to take about `DEMO_REPLAY_SECONDS` (default 20s). Errors are never cached.

Delete `data/cache/*.json` to re-record. The planner, orchestrator and analyst LLM turns still run live, so a full study takes 20s plus a few model turns.

## API

| Method | Path | Body → response |
|---|---|---|
| POST | `/studies` | `{question}` → `{study_id}` |
| GET | `/studies/{id}/events` | SSE (`event:` = type, `data:` = JSON). Replays history on connect, ends after `study_completed` / `study_failed` |
| POST | `/studies/{id}/approve` | `{action_id, approved, edited_args?, feedback?}` → 202. Resumes the agent once every pending action is answered |
| GET | `/studies/{id}/dataset` | `{plan, buildings, cells, findings}` |
| GET | `/studies/{id}` | status + pending approvals |

Every event has the shape `{type, study_id, seq, ts, data}`:

| type | data |
|---|---|
| `study_started` | `{question}` |
| `step_started` / `step_done` | `{step: subagent name, step_id, description \| summary}` |
| `tool_called` | `{step, name, args}`: a tool call made by a subagent |
| `plan_ready` | `{plan: {hypothesis, variables:[{name, source, type, label}], sample:{city, property_type, n}}}` |
| `building_added` | `{building: {building_id, costar_id, name, address, city, property_type, lat, lng}}` |
| `building_updated` | `{building_id, aerial_url}`: tile served at `GET /tiles/{file}` |
| `cell_updated` | `{cell}` (see Dataset) |
| `gap_detected` | `{building_id, variable, source, reason}` |
| `approval_required` | `{action_id, kind: "plan", tool, args, description, allowed_decisions, round, round_size}`; actions from one pause share `round` |
| `findings_ready` | `{findings[], effects[], by_decade[], chart_spec (Vega-Lite), limitations[], era_cutoff, n_buildings}` |
| `study_completed` / `study_failed` | `{summary}` / `{error}` (added so clients know when to stop listening) |

### Approval gate

The plan gate uses DeepAgents `interrupt_on` (HumanInTheLoopMiddleware) with a `MemorySaver` checkpointer.
**Plan** (`submit_plan`): approve, edit (`edited_args` replaces the plan) or reject (`feedback` is sent to the planner, which revises and resubmits).

A `when` predicate skips the gate for plans the tool would refuse anyway (an invalid plan), so humans only review real plans.

## Dataset

Each cell looks like:

```json
{"building_id": "B-03", "variable": "surface_parking_pct", "value": 42.0, "source": "vexcel",
 "confidence": 0.7, "evidence_ref": "Vexcel tile 29.75710_-95.36410.jpg",
 "status": "filled", "reason": null, "note": "Striped lot west of the tower.", "updated_at": 1763100000.0}
```

- Every building gets a cell for every planned variable. A cell without a value has `value: null`, `status: "missing"` and a `reason`.
- Tools write cells directly from the source, so values never pass through the LLM. If a tool fails, the cell is marked missing with the error as its reason; it is never estimated.
- The dataset lives in memory and is mirrored to `data/dataset.json` (latest study) and `data/studies/<id>/dataset.json`.
- The planner must choose variables from `VARIABLE_CATALOG` in `dataset.py`, so every planned variable has a tool that can fill it.

## Layout

```
backend/
  main.py           FastAPI app + SSE
  runner.py         streams the agent, maps progress -> events, handles interrupts/approvals
  agent.py          create_deep_agent: orchestrator prompt, 5 subagents, plan approval gate
  tools.py          the agent tools (all dataset writes happen here)
  dataset.py        provenance store + variable catalog
  analysis.py       pandas/scipy: decade-built comparison, bootstrap CIs, chart spec, limitations
  llm.py            vision model: ParkingMeasurement (Pydantic structured output)
  integrations.py   CoStar (kit / synthetic / sample) + Vexcel (live / placeholder tiles)
  cache.py          DEMO_MODE cache
  events.py         thread-safe per-study event bus with history
  config.py         .env loading
  data/             costar_sample.csv, tiles/, cache/
  scripts/          demo.sh (curl/SSE end to end), make_sample_tiles.py
  tests/            offline end-to-end test (scripted model), unit tests, fake_server.py
```

## Swapping in the real integrations

Only the stub function bodies change. Tools, events and the dataset stay the same.

**CoStar** (connected): `integrations.costar_fetch_properties(city, property_type, limit)` reads the sponsor's
CoStar data kit through the [`costar/`](../costar/README.md) package (`urbanlab_costar`, an editable dependency).
`URBANLAB_COSTAR_SOURCE` in the root `.env` picks the source:

| Value | Source |
|---|---|
| `auto` (default) | the kit if `COSTAR_KIT_ZIP` is set, otherwise the sample CSV |
| `kit` | the kit only; a study fails with a clear error if it isn't configured |
| `synthetic` | the package's invented test kit, so the whole path can be tested without sponsor data |
| `sample` | `data/costar_sample.csv` |

- To use the real kit, set `COSTAR_KIT_ZIP` and `COSTAR_ZIP_PASSWORD` and create the local field map; see `costar/README.md`.
  The kit is read straight from the zip, and kit records are never written to the demo cache.
- The sample is a seeded random draw from every matching property (`URBANLAB_SAMPLE_SEED`), not the lowest ids.
- Only Houston and Los Angeles have kit data, so the planner and `validate_plan` refuse other cities rather than substitute one.
- A field the kit doesn't have becomes a missing cell with the kit's reason, for example "not in the CoStar field map".
- `get_costar_properties` returns which source it used, and the analysis flags sample and synthetic records as limitations.

**Vexcel**: `integrations.vexcel_fetch_tile(lat, lng) -> Path`
- Request the ortho tile centred on the point and save it as `config.TILES_DIR / tile_name(lat, lng)`.
- Return that path, or raise when there's no coverage. The tool turns the exception into missing `vexcel` cells.
- Keep the tile a few hundred metres across, so one parcel fills most of the frame.
- If you change the zoom or format, re-check the `measure_parking` prompt in `llm.py`.

**Models**: both default to `google_genai:gemini-3.8-flash` via the Google Gemini API (`GOOGLE_API_KEY`). Set `URBANLAB_MODEL` and `URBANLAB_VISION_MODEL` to another `google_genai:<model>` id to change them.
