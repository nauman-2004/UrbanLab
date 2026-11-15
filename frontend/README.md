# UrbanLab — Frontend

Next.js 16 + TypeScript + Tailwind v4 UI for UrbanLab, an AI scientist for the built environment.

The UI is driven entirely by the agent backend's event stream (`../backend`, LangChain Deep Agents).
The plan, variables, buildings, values, approvals and findings all come from the backend;
nothing about the study is hard-coded here.

## Run it

One command starts the LangChain agent backend, waits until it's ready, then starts this UI connected to it.
Needs Node 20+, [uv](https://docs.astral.sh/uv/) and `GOOGLE_API_KEY` (a Gemini API key) in the repo-root `.env` (see `../.env.example`).

```bash
cd frontend
npm install          # first time only
npm run dev          # agent (real models via Google Gemini) + UI → http://localhost:3000, click "Run study"
npm run dev:fake     # agent with the scripted test model: no API key or quota needed
```

From the repo root, `dev` (Windows) or `./dev.sh` (macOS/Linux) does the same; add `fake` for the test model.
Both logs stream in one terminal (`[agent]` and `[web]`), and Ctrl+C stops both.
If a backend is already running on port 8000, the launcher reuses it.

Other scripts: `npm run dev:web` (UI only, mode from `.env`), `npm run build`, `npm run lint`.

## What a run looks like

1. **Run study** → the planner drafts a hypothesis, variables and a sample, and the agent **pauses for plan approval**
   (approve, or reject with feedback in live mode and the planner revises).
2. The data collector pulls CoStar records; pins appear on the map and rows fill in. Columns are the plan's variables.
3. The vision measurer reads each building's Vexcel tile; click a pin or row to see every layer for one building.
4. The gap analyst reports which values are missing and why.
5. **Findings** shows the backend's analysis: effect sizes with bootstrap 95% CIs, a by-decade chart, the
   PI's summary and every limitation the analyst reported.

CoStar records come from the CoStar data kit when it's configured (`URBANLAB_COSTAR_SOURCE=kit`). The sample CSV,
synthetic test kit and placeholder tiles are labelled `SAMPLE` / `SYNTHETIC` / "placeholder tiles" in the UI.

## Structure

```
src/
  app/                     routes: / (workspace), /findings
  components/
    shell/                 rail, header, question bar + stepper, integration bar
    workspace/             plan, map, building panel, activity, approval dialog, dataset table
    findings/              findings view, decade chart
    ui/                    Card, Icon, provenance tags/badges, waveform
  lib/
    events.ts              ★ StudyEvent — the backend's SSE events (the contract)
    types.ts               domain model mirroring backend/dataset.py (Cell = value + source + evidence + reason)
    state/                 reducer (events → state) + React provider
    source/                StudySource interface and LiveSource (SSE + /approve)
    format.ts, csv.ts      value formatting, dataset export with per-value provenance
```

## Design rules

- **Every value has a source.** Cells carry `source`, `evidence_ref` and `confidence`; the source color is used everywhere.
- **Missing is explicit.** A missing cell shows its reason; it is never estimated.
- **No numbers are computed in the UI.** Findings, CIs and limitations are rendered exactly as the backend's `analysis.py` produced them.

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for the event contract and endpoints.
