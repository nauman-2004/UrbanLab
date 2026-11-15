# UrbanLab

UrbanLab is an AI research assistant for commercial real estate. You ask a question in plain English about properties in Houston or Los Angeles. An AI agent turns it into a research plan, which you approve. It then pulls the matching property records from the CoStar data kit, measures parking from aerial imagery when the question needs it, and reports the results with a source for every value.

```
"From the Houston multifamily properties, find Class B buildings built 1975–1995 with no renovation
 since 2012, on lots of at least 5 acres and a building rating of 3. Rank them by lot size, top 5."

→ 113 of 1,348 Houston multifamily properties match. Top 5 by lot size:
  #1  CoStar 1560723  Circle at Point Park     built 1984   lot 1,923,540 sf   no renovation recorded
  #2  CoStar 6358277  Cabo San Lucas III       built 1976   lot 1,381,096 sf   no renovation recorded
  ...
```

## Contents

- [What it can do](#what-it-can-do)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Running modes](#running-modes)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Data handling](#data-handling)

## What it can do

UrbanLab answers two kinds of questions.

**Lookups: find, filter and rank properties.**
- *"List the 10 oldest office buildings in Los Angeles."*
- *"Houston industrial properties with a building rating of 4, largest first, top 5."*
- *"Class A or B offices in Houston built after 2000 on lots under 2 acres."*

Every condition in the question becomes an exact filter over the full CoStar dataset. The results say how many properties matched and how many were left after each filter.

**Comparisons: does something change with building age?**
- *"Do older office buildings in Houston dedicate more land to surface parking?"*

The agent samples properties, measures surface parking from Vexcel aerial imagery with a vision model, and compares older and newer buildings using bootstrap confidence intervals.

Every value in the dataset carries its source, such as `CoStar kit #1560723` or `Vexcel tile 29.736_-95.566.jpg`. A value the data doesn't have is marked missing with the reason; nothing is estimated or filled in.

## How it works

```
 Browser (Next.js, :3000)                      Agent backend (FastAPI, :8000)
 ─────────────────────────                     ─────────────────────────────────────────
 Question  ──── POST /studies ───────────────▶ Principal Investigator agent (LangChain Deep Agents, Gemini)
                                                 1. planner          drafts the plan ── you approve it ◀─┐
 Approval dialog ◀── approval_required ────────                                                         │
                ──── POST /studies/{id}/approve ─────────────────────────────────────────────────────────┘
                                                 2. data_collector   runs the exact CoStar search
 Map, table,     ◀── live event stream (SSE) ──  3. vision_measurer  aerial parking (only if the plan needs it)
 activity log                                    4. gap_analyst      what is missing and why
 Findings                                        5. analyst          ranked list, or statistics
                                                        │                    │
                                                 CoStar data kit       Vexcel imagery API
                                                 (local zip)           (live, budgeted)
```

- **The AI plans, the tools fetch.** The model decides *what* to look for, but values go straight from the data source into the dataset. The model never writes a number itself.
- **You approve every plan.** The approval dialog shows the property type, the city, every filter and the ranking before any data is pulled, so you can catch a misread question.
- **Statistics are computed in code** (`backend/analysis.py`, pandas and SciPy), not by the model.

More detail:
- [`backend/README.md`](backend/README.md): the agent, the API and events.
- [`frontend/README.md`](frontend/README.md): the UI.
- [`costar/README.md`](costar/README.md): the CoStar data adapters and their safety model.

## Getting started

### Prerequisites

| Tool | Version | Used for |
|---|---|---|
| [Node.js](https://nodejs.org) | 20 or newer | the web app |
| [uv](https://docs.astral.sh/uv/) | any recent | the Python backend (it installs Python 3.11 for you) |
| Google Gemini API key | | the AI model ([get one](https://aistudio.google.com/apikey)) |
| CoStar data kit | | the property data (zip and password from the hackathon CoStar track) |

A Vexcel API key is optional. You only need it for questions that measure parking from aerial imagery.

### 1. Install

```bash
git clone <repo-url> UrbanLab
cd UrbanLab

cd backend && uv sync && cd ..          # Python dependencies (creates backend/.venv)
cd frontend && npm install && cd ..     # web app dependencies
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set at least:

```ini
GOOGLE_API_KEY=your-gemini-key

URBANLAB_COSTAR_SOURCE=kit
COSTAR_KIT_ZIP=C:/path/to/costar-hackathon-kit.zip     # absolute path
COSTAR_ZIP_PASSWORD=the-kit-password
```

### 3. Add the CoStar field map

The kit's schema is confidential, so the file that maps its fields (`costar/.local/field_map.toml`) is not in git. Either ask a teammate for their copy over a private channel, or generate a draft and fill it in yourself:

```bash
cd backend
uv run python -m urbanlab_costar kit-inspect --confirm-local-access --write-draft
# then copy costar/.local/field_map.draft.toml to field_map.toml and complete it (see costar/README.md)
uv run python -m urbanlab_costar kit-validate --confirm-local-access   # shows how complete each field is
```

To check the whole setup at any time, run `uv run python -m urbanlab_costar doctor`. It shows secrets only as `set` or `missing`.

### 4. Run

```bash
cd frontend
npm run dev
```

This starts the backend, waits until it's ready, then starts the web app. Open **http://localhost:3000**, type a question and click **Run study**. Both logs stream in the same terminal, and Ctrl+C stops both.

When it starts, look for this line. It confirms which model and data source are in use:

```
Agent backend ready · model google_genai:gemini-3.8-flash · CoStar source: kit
```

From the repo root you can also run `dev` (Windows) or `./dev.sh` (macOS/Linux).

## Configuration

All settings live in one file, `.env` in the repo root, and every part of the app reads it. [`.env.example`](.env.example) lists them all with comments. The ones you're most likely to change:

| Variable | Default | What it does |
|---|---|---|
| `GOOGLE_API_KEY` | none | Gemini API key. Required for live runs. |
| `URBANLAB_MODEL` / `URBANLAB_VISION_MODEL` | `google_genai:gemini-3.8-flash` | The agent model and the aerial-image model |
| `URBANLAB_COSTAR_SOURCE` | `auto` | `kit` (real data), `synthetic` (invented test data), `sample` (small placeholder CSV), or `auto` (kit if configured, otherwise sample). Use `kit` for real work: it fails loudly instead of quietly falling back. |
| `COSTAR_KIT_ZIP`, `COSTAR_ZIP_PASSWORD` | none | Location of and password for the CoStar kit |
| `DEFAULT_SAMPLE_N` | `8` | Properties per study when the question doesn't say |
| `URBANLAB_MAX_PROPERTIES` | `25` | Hard cap on properties per study |
| `VEXCEL_API_KEY` | none | Vexcel key for aerial imagery |
| `URBANLAB_LIVE_MODE`, `VEXCEL_LIVE` | `0` | Both must be `1` before any paid imagery request is made |
| `VEXCEL_MAX_REQUESTS_PER_RUN` | `0` | Image request budget per study. Saved images are reused, so the same building is never paid for twice. |
| `DEMO_MODE` | `1` | Caches non-kit property results and image measurements so repeat runs are fast |

Never put secrets in variables that start with `NEXT_PUBLIC_`: those are bundled into the browser.

## Running modes

| Command (in `frontend/`) | Backend | Needs | Use it for |
|---|---|---|---|
| `npm run dev` | real agent with Gemini | API key and kit | normal use |
| `npm run dev:fake` | real agent with a scripted test model | nothing | working on the UI or backend without using your API quota |

## Project structure

```
UrbanLab/
├── backend/                 Python agent backend (FastAPI + LangChain Deep Agents)
│   ├── main.py              HTTP API and live event stream (SSE)
│   ├── agent.py             The agent: orchestrator prompt, 5 subagents, plan approval gate
│   ├── tools.py             Tools the agent calls; validates plans and writes every value to the dataset
│   ├── integrations.py      CoStar search (filters, ranking, type names) and Vexcel imagery
│   ├── analysis.py          Lookup results and age-comparison statistics
│   ├── dataset.py           Dataset with a source for every value; the catalog of collectable variables
│   ├── llm.py               Aerial-image parking measurement (vision model, structured output)
│   ├── runner.py            Runs the agent, turns its progress into events, handles approvals
│   ├── data/                Sample CSV, placeholder tiles, saved Vexcel images (tiles/live), demo cache
│   ├── scripts/             demo.sh (run a study from the terminal), make_sample_tiles.py
│   └── tests/               Offline end-to-end test (scripted model) and unit tests
├── costar/                  urbanlab_costar package: reads the CoStar kit, Vexcel and Matterport adapters,
│                            CLI (doctor, kit-inspect, kit-validate, purge). See costar/README.md.
├── frontend/                Next.js 16 + React 19 + Tailwind web app
│   ├── scripts/dev.mjs      One-command launcher (backend + web app)
│   └── src/                 Pages, components, event-stream state
├── .env.example             Every setting, documented
├── dev.cmd, dev.sh          Launch from the repo root
└── README.md
```

## Testing

```bash
cd backend && uv run pytest -q        # agent, tools, search and analysis; offline, no API key needed
cd costar  && uv run pytest -q        # CoStar package; uses synthetic data only
cd frontend && npx tsc --noEmit && npm run lint
```

The backend's end-to-end test runs the real agent graph, tools and approval gate with a scripted model, so it needs no API key or network.

To run one study from the terminal against a running backend, auto-approving the plan:

```bash
cd backend
QUESTION="List the 10 oldest office buildings in Los Angeles" bash scripts/demo.sh
```

## Troubleshooting

**The UI doesn't reflect a change you made, or the start-up line shows the wrong model or source.**
The launcher reuses a backend that is already running on port 8000, and it says so: `Agent backend already running … using it`. Stop that process, or close the terminal running it, then run `npm run dev` again.

**`EADDRINUSE: address already in use :::3000`**
Another copy of the web app is still running. Stop it and start again.

**A study fails with a rate-limit or quota error.**
Your Gemini key has hit its limit. Wait, or use a key with a higher quota. Each study makes about 30 model requests.

**`CoStar kit unavailable: COSTAR_KIT_ZIP is not set`**
Set `COSTAR_KIT_ZIP` and `COSTAR_ZIP_PASSWORD` in `.env`, then run `uv run python -m urbanlab_costar doctor` from `backend/`.

**A value shows `not in the CoStar field map`.**
That field isn't mapped in `costar/.local/field_map.toml`. Add it, or get the team's copy of the map.

**A lookup returns 0 matches.**
The findings show how many properties were left after each filter, so you can see which condition removed them. Some fields are often empty in the kit. For example, building area is almost never recorded for apartments, because CoStar describes those by unit count.

**Aerial parking values are all missing.**
Live Vexcel requests are off by default. Set `VEXCEL_API_KEY`, `URBANLAB_LIVE_MODE=1`, `VEXCEL_LIVE=1` and a budget in `VEXCEL_MAX_REQUESTS_PER_RUN`.

## Limitations

- **Cities:** Houston and Los Angeles only (the kit's coverage), and one city and one property type per question.
- **Searchable fields:** year built, last renovated, building area, lot size, stories, building class, CoStar rating, parking spaces and parking ratio. Unit counts, rents, sale prices, owners, submarkets and ZIP codes aren't searchable yet.
- **Not searched:** the kit's lease and sale listings, sale comps and tenant records.
- **Conditions:** all conditions are combined with AND. "This or that" across different fields isn't supported, and there are no distance or radius searches.
- **Results:** at most 25 properties per question (`URBANLAB_MAX_PROPERTIES`), though the match count always covers the full dataset.
- **Aerial measurements** are vision-model estimates of surface parking and exclude parking garages.
- **Speed:** each search reads the whole kit, so it takes about 20–40 seconds.

## Data handling

The CoStar kit, its field map and your `.env` are sponsor data or secrets, and they are kept out of git: `*.zip`, `.env` and `costar/.local/` are all ignored. Kit records are never written to the demo cache. To remove every local copy of sponsor-derived files, run:

```bash
cd backend && uv run python -m urbanlab_costar purge --yes                     # costar/.local/ and the field map
cd backend && uv run python -m urbanlab_costar purge --yes --include-sources   # also deletes the kit zip itself
```
