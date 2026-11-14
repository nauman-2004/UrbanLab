# UrbanLab — Frontend

Next.js 16 + TypeScript + Tailwind v4 UI for UrbanLab, an AI scientist for the built environment.

It runs **fully standalone**: a deterministic replay of a synthetic study drives the whole UI, so it works without the agent backend, API keys, or a network connection (after the first build fetches the fonts).

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
npm run build        # production build + type-check
npm run lint
```

## Demo script (≈2 minutes)

1. **Run study** → the agent drafts the plan and pulls 12 buildings from CoStar. Pins drop on the map and rows fill in.
2. Surface lots are measured from Vexcel aerials and garages from Matterport. Click any pin or row to see all layers for one building.
3. The agent finds **3 evidence gaps** (off-site leased parking can't be observed digitally) and **pauses for approval**.
4. **Approve** → field interviews run (Cartesia). Click **Expand interview** to show the live transcript and consent badges. Each extracted value lands in the dataset marked **⚠ UNVERIFIED**.
5. Open **Findings**. The headline, stats, charts, sensitivity check and limitations are all computed from the dataset. The interviews change the conclusion.
6. Optional: click **Verify…** on an interview value to show how self-reported data gets confirmed. Every number updates.

Use **2×** or **4×** in the question bar to shorten the run (≈70 s at 1×).

## Structure

```
src/
  app/                     routes: / (workspace), /findings
  components/
    shell/                 rail, header, question bar + stepper, integration bar
    workspace/             plan, map, property panel, activity, interview mini + drawer,
                           approval modal, dataset table, verify control
    findings/              findings view, scatter, stacked supply bars
    ui/                    Card, Icon, provenance tags/badges, waveform
  lib/
    types.ts               domain model (Cell = value + source + verification + evidence)
    events.ts              ★ StudyEvent / StudyCommand — the backend contract
    state/                 reducer (events → state) + React provider
    source/                StudySource interface: ReplaySource (demo) · LiveSource (SSE)
    replay/script.ts       deterministic event script generated from the synthetic data
    data/houston.ts        SYNTHETIC dataset (fictional building names, plausible values)
    analysis.ts, stats.ts  derived values + findings (Spearman, exact Mann-Whitney)
    csv.ts                 dataset export with per-value provenance
```

## Design rules enforced in code

- **Every value has a source.** A cell is `{ value, source, verification, evidence }`, and the source color is used everywhere it appears.
- **Self-reported ≠ observed.** Interview values are `unverified` (amber ⚠, dashed outline) until a researcher records independent evidence. The findings report results with and without them.
- **Nothing on the Findings page is hard-coded.** Headline numbers, p-values, charts and limitations are computed from the current dataset. Declining the interviews or verifying a value updates them.

## Connecting the real backend

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md). In short: implement three endpoints that emit/accept the types in `src/lib/events.ts`, then run with

```bash
NEXT_PUBLIC_STUDY_SOURCE=live NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

Design references for the approved V2 UI are in `../docs/design/v2/`.
