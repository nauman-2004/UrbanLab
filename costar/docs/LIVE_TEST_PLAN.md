# Minimal live test plan (Phase D: needs explicit approval for each step)

Nothing in this document has been run. Each step needs its own approval. Budgets are hard limits enforced in code, and retries count against them.

**Pricing / quotas:** no pricing, billing or quota terms are published for the hackathon Matterport or Vexcel keys. The only stated rule is "keep requests modest, well under 10 per second; everyone shares these keys". I'm treating every request as potentially metered. Worth asking `/ask-costar` before step 2.

## Step 1: open the CoStar kit locally (0 network requests)

- **What:** read the kit zip with the password and print its groups and key paths to the local terminal.
- **Why:** to fill the git-ignored field map. Every real CoStar mapping is unverified until this is done.
- **Commands:**
  ```bash
  python -m urbanlab_costar doctor
  python -m urbanlab_costar kit-inspect --confirm-local-access --write-draft
  ```
- **Data handling:**
  - Output stays in the local terminal and `costar/.local/`.
  - Nothing is extracted, committed or sent anywhere.
  - Field paths are confidential, so they aren't pasted into chats or PRs.
- **Done when:** `plan --mode real` shows the Houston office sample and which of `year_built`, `building_area_sf`, `land_area_sf`, `parking_*`, `garage_stalls` and `occupancy_pct` really exist.

## Step 2: Vexcel smoke test, 1 property (max 2 requests)

- **`.env` settings:**
  - `URBANLAB_LIVE_MODE=1`, `VEXCEL_LIVE=1`
  - `VEXCEL_MAX_REQUESTS_PER_RUN=2`, `URBANLAB_MAX_RETRIES=0`, `VEXCEL_MAX_RPS=1`
  - `URBANLAB_MAX_PROPERTIES=1`
- **Requests:**
  1. `GET /v2/property/extract`: parcel polygon and structures for one Houston office from the kit.
  2. `POST /v2/elements/detect`: SAM3 `"parking lot"` on the ortho of that parcel (bbox + confidence only, no masks).
- **Why:** to check the real response fields the parser uses (`features[0].geometry`, `metadata.collection`, `structures[].footprint.area`, `detections[].bbox/confidence`) and the area maths on one real parcel.
- **Command:**
  ```bash
  python -m urbanlab_costar run --mode real --approve-live --spec spec-1.json
  ```
  `spec-1.json` sets `sample_limit: 1` and the variables `land_area_sf`, `surface_parking_sf`. Keep it in `costar/.local/`.
- **Report:**
  - observed field presence
  - the parcel area versus the kit's land area
  - the detection count and confidence
  - a visual spot-check of the ortho in the Vexcel viewer
  - no raw responses saved to git

## Step 3: Vexcel pilot, 5 properties (max 10 requests)

- **Settings:** same as step 2, with `VEXCEL_MAX_REQUESTS_PER_RUN=10` and `URBANLAB_MAX_PROPERTIES=5`. Optionally `URBANLAB_MAX_RETRIES=1`, but retries count against the budget.
- **Why:** to check robustness (404s, multi-parcel points, irregular lots) before any demo-scale run.
- **Spot-check:** compare 2–3 parking estimates by eye against the ortho image.

## Step 4 (optional): Matterport, 1 request

- **Settings:** `MATTERPORT_LIVE=1`, `MATTERPORT_MAX_REQUESTS_PER_RUN=1`.
- **Request:** `POST https://api.matterport.com/api/models/graph` with the `Rooms` query for one model linked to a sampled property.
- **Why:** this is needed only if the demo shows room types or amenities. Linked-model counts and the Showcase link come from the local index and cost **0** requests.
- **Never used for parking.**

## Demo-scale run (only after steps 2–3 look right)

- **Sample:** 30 offices.
- **Requests:** 30 parcel lookups + 30 detections = **60 Vexcel requests**. With 2 retries the worst case is 180, so set `VEXCEL_MAX_REQUESTS_PER_RUN=60` and the run stops at 60.
- **Approval:** I'll present the exact number again before asking.

## Not planned

- No bulk downloads.
- No imagery saved except one ortho for the demo if approved, kept in `costar/.local/`.
- No embedding searches.
- No oblique imagery.
- No paid LLM calls.
- No sponsor data sent to Gemini, Nemotron or Cartesia.
