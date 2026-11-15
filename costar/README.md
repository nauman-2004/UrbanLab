# `costar/`: UrbanLab sponsor-data adapters

This package provides reusable, provenance-aware adapters for the HackPrinceton CoStar track data: the **CoStar data kit**, **Vexcel API 2.0** and **Matterport**. It also includes a planner that works out which sources can honestly answer a research question, and a serializer for the frontend's `StudyEvent` contract.

It is a library and CLI for the agent backend (Deep Agents) to call. It does **not** contain an agent, an LLM call or a voice pipeline.

> **Status.**
> - **CoStar kit adapter:** validated locally against the real kit. It was opened with approval, with fill rates checked and joins verified.
> - **Vexcel and Matterport API adapters:** tested only against synthetic fixtures. No authenticated request has been made (see [Live test plan](docs/LIVE_TEST_PLAN.md)).
> - **Unit tests:** use synthetic data only.

## Quick start (offline, no keys needed)

```bash
cd costar
python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest              # 82 offline tests; network is blocked in tests
.venv/bin/mypy                          # strict type check
.venv/bin/python -m urbanlab_costar demo            # synthetic Houston parking study
.venv/bin/python -m urbanlab_costar demo --events   # same, as StudyEvent JSON lines
.venv/bin/python -m urbanlab_costar plan            # plan only: sources, gaps, request estimate
```

## Configuration: one shared root `.env`

Every component reads the **single root `.env`**; there is no `.env` inside `costar/`. The template with every variable name is the root [`.env.example`](../.env.example).

1. `cp .env.example .env` at the **repository root**, then fill it in locally. Never paste values into chats or commits.
2. **In a git worktree** (for example `UrbanLab-costar/`), the main checkout's untracked `.env` is not visible. Don't copy or symlink it. Point at it read-only instead:
   ```bash
   export URBANLAB_ENV_FILE=/absolute/path/to/UrbanLab/.env
   ```
3. Check the configuration. Secrets are shown only as `set` / `missing`:
   ```bash
   .venv/bin/python -m urbanlab_costar doctor
   ```

| Variable | Secret | Purpose |
|---|---|---|
| `COSTAR_KIT_ZIP` | | absolute path to the downloaded kit zip |
| `COSTAR_ZIP_PASSWORD` | yes | kit zip password |
| `COSTAR_KIT_URL` | | informational; never downloaded automatically |
| `COSTAR_FIELD_MAP` | | local field map (default `costar/.local/field_map.toml`) |
| `MATTERPORT_API_KEY` / `MATTERPORT_API_TOKEN` | yes | Model API basic auth (server-side only) |
| `MATTERPORT_INDEX_CSV` | | absolute path to the sponsor `models_index.csv` |
| `MATTERPORT_SDK_KEY` | yes | Embed SDK key; **not used by this package** (see below) |
| `MATTERPORT_SDK_ALLOWED_DOMAINS` | | domains registered for the SDK key |
| `VEXCEL_API_KEY` | yes | sent only as the `X-API-KEY` header, never in a URL |
| `URBANLAB_LIVE_MODE`, `VEXCEL_LIVE`, `MATTERPORT_LIVE` | | all default `0` |
| `VEXCEL_MAX_REQUESTS_PER_RUN`, `MATTERPORT_MAX_REQUESTS_PER_RUN` | | hard per-run budgets, default `0` |
| `VEXCEL_MAX_RPS`, `MATTERPORT_MAX_RPS` | | default 1/s, capped at 5/s |
| `URBANLAB_HTTP_TIMEOUT_S`, `URBANLAB_MAX_RETRIES` | | default 60 s; 2 retries, capped at 3 |
| `URBANLAB_MAX_PROPERTIES` | | hard sample cap per run (default 25) |
| `URBANLAB_SPONSOR_DATA_DIR` | | local sponsor-data dir (default `costar/.local/`, git-ignored) |

**Never** create `NEXT_PUBLIC_*` versions of any of these. `doctor` flags them and exits non-zero.

## Safety model

- **Two explicit modes:**
  - `synthetic`: invented fixtures, no sponsor data, no network.
  - `real`: the local kit and index, with authenticated APIs **only** when every switch allows it.
- **Live requests require all of:** `URBANLAB_LIVE_MODE=1`, `<PROVIDER>_LIVE=1`, a budget greater than 0, credentials, and `approved_live_requests=True` from the agent's human-approval step. Otherwise the transport refuses before any socket opens.
- **Every attempt counts against the budget, including retries.** Requests are spaced at most `MAX_RPS` per second. Only 429/5xx are retried, at most 3 times, with `Retry-After` capped at 30 s. An identical request is never sent twice in a run.
- **Vexcel calls are checked against approximate region boxes first.** Out-of-coverage points cost nothing. A real 403 still becomes an `out_of_coverage` gap.
- **Logs** contain provider, method, path and status only. Registered secrets and credential-looking tokens are redacted from all messages and errors.
- **Nothing runs a live request on import, test, startup or reload.** Tests block sockets, and one test imports every module in a clean interpreter with networking disabled.

## Data provenance

Every value is a `Value` with `source` (costar / vexcel / matterport / interview / derived), `method`, `verification`, optional `confidence` and `uncertainty`, and an `evidence.ref`. The possible methods:

| Method | Meaning | Example |
|---|---|---|
| `observed` | read from a record | CoStar year built |
| `computed` | UrbanLab arithmetic on observed input | lot area from the Vexcel parcel polygon |
| `model_estimate` | a model produced it | surface parking from Vexcel `elements/detect`, footprints, Matterport room types |
| `self_reported` | a person said it; starts `unverified` | interview answers |

Derived values inherit the weakest input. A share built from an estimate stays an estimate. Missing data is always an explicit `Gap` with a `kind` and `reason`, never a default value.

**Limits that are deliberate:**
- Matterport scans are **never** used for parking or garage capacity.
- Imagery is never used to infer parking ownership or leases.
- Off-site parking is interview-only.
- A planner picks **one source per variable** per study, so values stay comparable. For example, lot area comes from the kit if that field is mapped, otherwise from the Vexcel parcel.

## Package layout

```
src/urbanlab_costar/
  config.py        root .env resolution, Settings, live gates (no os.environ writes)
  redaction.py     Secret wrapper, redaction, log filter
  budget.py        per-run request budget + rate spacing
  http.py          Blocked/Urllib transports, ApiClient (retries, memo, safe logs)
  geo.py           regions/coverage, WKT (lon lat), areas, grid-union overlap
  provenance.py    Value / Gap / Method / Source, derive_ratio
  kit/             archive (zip/dir, password, AES detection), mapping (local TOML),
                   inspect (schema discovery, local only), repository (filter/lookup/join)
  vexcel/          client (property/extract, elements/detect, ortho, oriented, embedding),
                   parse, adapter (values + gaps)
  matterport/      index (models_index.csv), client (GraphQL), adapter
  research/        variables (catalog + honest sources), spec (+ JSON schema),
                   planner (source choice, gaps, request estimate), pipeline (run + events)
  events.py        StudyEvent serializer + validator mirroring frontend/src/lib/events.ts
  interviews.py    interface for interview-derived values (no calls placed here)
  dataset.py       provenance-aware dataset, CSV/JSON export
  runtime.py       wiring for synthetic / real modes
  tools.py         JSON-in/out functions for the agent
  purge.py, cli.py
```

## Agent integration (Deep Agents)

Wrap the functions in `urbanlab_costar.tools` with your tool decorator:

1. `research_spec_schema()`: the JSON Schema the LLM fills in from the user's question.
2. `describe_capabilities(mode)`: the variables, configured sources and coverage. Makes no requests.
3. `plan_research_tool(spec, mode)`: the per-variable source and method, unavailable variables with reasons, and `requests` / `worst_case_requests_with_retries` against the budgets. Use `needs_live_requests` to trigger `approval.requested`.
4. `run_research_tool(spec, mode, approved_live_requests=..., emit=callback)`: streams strict-contract `StudyEvent`s to `emit` (forward them over SSE). It returns the dataset, gaps, warnings and requests used.
5. **Interviews** (owned by the Cartesia teammate):
   - `interviews.interview_requests(dataset)` lists the gaps that need a person.
   - `InterviewAnswer(...).to_value()` / `apply_answer(...)` record an answer as self-reported and **unverified**, with the quote and timestamp.

The agent still owns approval, interviews, `analysis.started` and `report.ready`. The frontend computes the statistics.

## Matterport embed (for the frontend)

- **Use the hosted Showcase iframe.** The adapter returns `PropertyInfo.matterportUrl` as `https://my.matterport.com/show/?m=<sid>&play=1&qs=1`, per the sponsor quickstart. The iframe needs **no key**.
- **Don't add the Embed SDK, Web Component or Bundle SDK** unless a feature needs scene-graph access. The SDK key is loaded by the browser, so it can't be kept secret there, and it's restricted by the allowed-domains setting. Confirm Matterport's current SDK-key guidance before using it. Until then, keep `MATTERPORT_SDK_KEY` server-side and out of `NEXT_PUBLIC_*`.
- The Model API key and token **never** reach the browser.

## Using the real kit (only after approval)

```bash
python -m urbanlab_costar kit-inspect --confirm-local-access --write-draft   # local terminal only
cp costar/.local/field_map.draft.toml costar/.local/field_map.toml           # then fill in rules
python -m urbanlab_costar kit-validate --confirm-local-access                # fill rates per region/type
python -m urbanlab_costar plan --mode real
```

Field rules can decode integer enums with the kit's own enum file, filter and aggregate lists (for example a construction-complete year, or summed surface spaces), apply a unit recorded per record, and join address parts. A sum or count over a list is recorded as `computed`. Regions are selected by the kit's market ids, set under `[regions]` in the local map. Every catalog variable whose kit field is mapped becomes available. **Any other mapped field also becomes a usable variable** (with an `observed` value), so research questions aren't limited to the catalog.

**Regions:** research specs accept **only `houston` and `los_angeles`**, the CoStar kit's coverage. Other Vexcel geofence areas are rejected at the spec level, in the JSON schema and in the planner.

The inspection output is the sponsor's confidential schema. It goes to the local terminal and the git-ignored `costar/.local/` folder only. The kit is read in place, as a stream; nothing is extracted to disk. AES-encrypted zips need the `aes` extra (`pyzipper`).

## Deleting sponsor data (event ends Nov 15, 2026, 4:00 PM EST)

```bash
python -m urbanlab_costar purge                               # dry run: lists what would go
python -m urbanlab_costar purge --yes                         # costar/.local/ + field map
python -m urbanlab_costar purge --yes --include-sources       # also the kit zip + models index CSV
```

Also delete manually:
- any copies outside the configured paths, such as the download folder and the trash
- exported CSVs
- screenshots containing records
- the root `.env` entries

## Known limitations

- The real field map lives only in `costar/.local/`, so each teammate creates their own. Ask the CoStar owner for a copy over a private channel; never use git for it.
- **Occupancy** is the *recorded tenant occupancy*: occupied SF of current tenancies divided by RBA, on the kit snapshot date (`[kit] as_of`). It's only reported when every current tenancy has an area and the result is at most 100%. It is **not** a vacancy rate.
- **Vacancy** is only what the kit records (apartment communities). Office vacancy isn't derived from tenancies, following the kit's guidance.
- Listings and sale comps aren't joined yet.
- The kit has no explicit garage-stall field. Covered spaces are exposed as `parking_spaces_covered`, but they're **not** treated as `garage_stalls`.
- The geofence boxes are approximate pre-checks. The provider's response is authoritative.
- Surface parking is a bounding-box union of SAM3 detections, so it overstates irregular lots. The more precise mask-based polygons aren't implemented yet. Plan a manual spot-check before quoting numbers.
- `land_area_sf` from Vexcel is the parcel polygon area computed with a local planar projection, accurate at parcel scale.
- In strict mode, only the six frontend variable keys stream to the UI. Everything else is in the returned dataset. See [`docs/CONTRACT_PROPOSAL.md`](docs/CONTRACT_PROPOSAL.md).
