# UrbanLab agent backend

A research question goes in. A LangChain **DeepAgents** "Principal Investigator" then:

1. plans the study (**human gate #1**),
2. pulls CoStar records,
3. measures parking from Vexcel aerial tiles with a vision model (via OpenRouter),
4. finds the evidence it can't observe,
5. phones property managers (**human gate #2**, once per call),
6. runs the statistics.

Every value lands in a dataset with provenance, and progress streams over SSE.

Demo question: *"How prepared are commercial office properties in Houston for EV adoption?"*

> **Placeholder data:** until the real integrations are wired in, `data/costar_sample.csv`, `data/tiles/*.png` (schematic drawings) and `telephony.start_call()` (scripted transcript) are **stubs**. Values from them are labelled in the dataset (`costar_id` `SAMPLE-…`, `evidence_ref` `STUB …`), and the analysis lists them as limitations. Don't present these numbers as findings.

## Run it

```bash
cd backend
uv sync                                        # Python 3.11 venv + deps (uv installs 3.11 if needed)
uv run python scripts/make_sample_tiles.py     # only if data/tiles/ is empty
# put OPENROUTER_API_KEY (and optionally DEMO_MODE=1) in the repo-root .env — see .env.example
uv run uvicorn main:app --port 8000
```

In a second terminal:

```bash
bash scripts/demo.sh                    # runs the demo question end to end, auto-approving both gates
AUTO_APPROVE=0 bash scripts/demo.sh     # answer y/n at each gate yourself
```

To run without an API key, use the scripted fake model. It drives the real graph, tools and interrupts:

```bash
uv run pytest -q                                      # offline end-to-end + unit tests
uv run uvicorn tests.fake_server:app --port 8000      # API with the fake model
```

### Demo mode

With `DEMO_MODE=1`, the first run calls CoStar and the vision model live and writes the outputs to `data/cache/`.

Later runs replay those cached outputs, paced to take about `DEMO_REPLAY_SECONDS` (default 20s). The survey call and transcript extraction always run live. Errors are never cached.

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
| `step_started` / `step_done` | `{step: subagent name, step_id, description \| summary}` |
| `plan_ready` | `{plan: {hypothesis, variables:[{name, source, type, label}], sample:{city, property_type, n}}}` |
| `cell_updated` | `{cell}` (see Dataset) |
| `gap_detected` | `{building_id, variable, source, reason}` |
| `approval_required` | `{action_id, kind: "plan"\|"survey", tool, args, description, allowed_decisions}` |
| `call_transcript` | `{building_id, call_id, contact_role, consent, transcript:[{speaker, text, t}], duration_s, stub}` |
| `findings_ready` | `{findings[], effects[], by_decade[], chart_spec (Vega-Lite), limitations[], era_cutoff, n_buildings}` |
| `study_completed` / `study_failed` | `{summary}` / `{error}` (added so clients know when to stop listening) |

### Approval gates

Both gates use DeepAgents `interrupt_on` (HumanInTheLoopMiddleware) with a `MemorySaver` checkpointer:

- **Plan** (`submit_plan`): approve, edit (`edited_args` replaces the plan) or reject (`feedback` is sent to the planner, which revises and resubmits).
- **Survey** (`request_survey_call`): approve or reject, once per call. A rejected call is never placed, and its cells are marked missing with "Survey call not approved by the reviewer."

A `when` predicate skips the gate for calls the tool would refuse anyway, such as an invalid plan or a call over `SURVEY_MAX_CALLS`. That way humans only review real actions.

## Dataset

Each cell looks like:

```json
{"building_id": "B-03", "variable": "ev_chargers_installed", "value": 4, "source": "survey",
 "confidence": 0.9, "evidence_ref": "call-1a2b3c @ 00:12: \"We have 4 charging ports…\"",
 "status": "filled", "reason": null, "note": "Self-reported, unverified.", "updated_at": 1763100000.0}
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
  agent.py          create_deep_agent: orchestrator prompt, 6 subagents, interrupt_on gates
  tools.py          the agent tools (all dataset writes happen here)
  dataset.py        provenance store + variable catalog
  analysis.py       pandas/scipy: decade-built comparison, bootstrap CIs, chart spec, limitations
  llm.py            vision (ParkingMeasurement) + transcript extraction (Pydantic)
  integrations.py   CoStar + Vexcel clients (STUBS)
  telephony.py      start_call() (STUB, for Twilio + Cartesia)
  cache.py          DEMO_MODE cache
  events.py         thread-safe per-study event bus with history
  config.py         .env loading
  data/             costar_sample.csv, tiles/, cache/
  scripts/          demo.sh (curl/SSE end to end), make_sample_tiles.py
  tests/            offline end-to-end test (scripted model), unit tests, fake_server.py
```

## Swapping in the real integrations

Only the stub function bodies change. Tools, events and the dataset stay the same.

**CoStar**: `integrations.costar_fetch_properties(city, property_type, limit)`
- Call the CoStar API and return a list of dicts with these keys: `costar_id, name, address, city, property_type, lat, lng, year_built, rba_sf, lot_sf, building_class, occupancy_pct, parking_spaces, parking_ratio`.
- Use `None` for anything CoStar doesn't have. Never fill in defaults; `None` becomes a missing cell with a reason.
- Put credentials in `.env` and read them in `config.py`.

**Vexcel**: `integrations.vexcel_fetch_tile(lat, lng) -> Path`
- Request the ortho tile centred on the point and save it as `config.TILES_DIR / tile_name(lat, lng)`.
- Return that path, or raise when there's no coverage. The tool turns the exception into missing `vexcel` cells.
- Keep the tile a few hundred metres across, so one parcel fills most of the frame.
- If you change the zoom or format, re-check the `measure_parking` prompt in `llm.py`.

**Twilio + Cartesia**: `telephony.start_call(building, questions, contact_role) -> CallResult`
- Dial the contact, get verbal consent first, ask the questions, hang up.
- Return the transcript as `[{speaker: "agent"|"contact", text, t}]` with `stub=False`.
- If consent is refused, return `consent=False`; all survey cells become missing with "Contact declined".
- The function blocks until the call ends, which is fine because tools run in worker threads.
- To stream utterances live, call `events.emit(study_id, "call_transcript", …)` from inside the call loop. You get `study_id` from `tools._study_id()`.
- Phone numbers aren't in the CoStar sample yet. Add a `contact_phone` column to the CoStar mapping and read it from `building`.

**Models**: set `URBANLAB_MODEL`, `URBANLAB_VISION_MODEL` and `URBANLAB_EXTRACTION_MODEL` to any LangChain `provider:model` id.
