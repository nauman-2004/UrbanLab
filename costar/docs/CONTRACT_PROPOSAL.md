# Proposed frontend contract changes (NOT applied)

Status: **proposal for the frontend owner and team lead**. Nothing under `frontend/` was changed.
`costar` emits the current contract exactly by default (`profile="strict"`). The changes below exist only behind `profile="extended"` so they can be tried out without breaking anything.

## Why

With real sponsor data, the current types run into four problems:

1. **There's no way to mark a value as a model estimate.** `verification` is `observed | unverified | verified`, so a Vexcel segmentation estimate looks the same as a recorded value. In strict mode we put `MODEL ESTIMATE · … · uncertainty: …` into `evidence.note` and the confidence into `evidence.confidence`. That works, but the UI can't style it.
2. **`PropertyInfo.propertyClass: "A" | "B"` and `occupancyPct: number` are required.** Real records can be class C or have the field missing. We never invent either value: if the data lacks one, it's left out and listed in `contract_warnings`. The panel then shows "Class undefined" / "undefined%" (see `PropertyPanel.tsx:51,61`).
3. **`VariableKey` has only the six parking-study keys.** Other research questions (vacancy, amenities, site coverage) can't stream their variables.
4. **Garage stalls are documented as coming from Matterport** (`INTEGRATION.md`, "Count structured parking in the scan"). Real Matterport models are mostly single suites, units or amenities, so `costar` never uses scans for parking.

## Proposed additions (all optional, backward compatible)

```ts
// types.ts
export type Method = "observed" | "computed" | "model_estimate" | "self_reported";

export interface Provenance {
  method: Method;
  unit?: string | null;
  confidence?: number | null;      // 0..1
  uncertainty?: string | null;     // human-readable caveat
  inputs?: string[];               // for computed/derived values
}

export interface Cell<T = number> {
  // ...existing fields...
  provenance?: Provenance;         // NEW, optional
}

export interface PropertyInfo {
  // ...
  propertyClass?: string;          // was required "A" | "B"
  occupancyPct?: number;           // was required
}

// Allow catalog variables beyond the six demo keys:
export type VariableKey = "yearBuilt" | "lotSf" | "rbaSf" | "surfaceSf" | "garageStalls" | "offsiteSpaces"
  | (string & {});
```

## Documentation fixes suggested for `frontend/docs/INTEGRATION.md`

- Matterport row: replace "Count structured parking in the scan" with "Linked scans (`matterportUrl`), room types; **not** used for parking".
- CoStar row: there is no CoStar SDK/MCP/OpenAPI. It's a local data kit read by `costar/`.
- Vexcel row: `surfaceSf` comes from Vexcel's own `elements/detect` (SAM3), not from a separate vision LLM. Mark it as a model estimate.

## Runtime behaviour today

The reducer spreads `...e.cell`, so an extra `provenance` key passes through without breaking anything. TypeScript only notices on the producer side. Even so, `extended` stays off by default until this proposal is approved.

## Missing-data states (needed before real data is shown)

**What the backend does today:**
- It never sends a placeholder. `occupancyPct` and `propertyClass` are sent only when the data supports them.
- `occupancyPct` is the *recorded tenant occupancy*: occupied SF of current tenancies divided by RBA, as of the kit snapshot date. It is **not** a vacancy rate.
- With `profile="extended"`, `PropertyInfo` also carries a proposed `missing` map with the reason for each absent field, e.g. `{"occupancyPct": "1 of 2 current tenancies have no occupied area; a total would understate occupancy"}`.

**The current frontend** renders an absent field as `undefined%` / `Class undefined`. It also hard-codes "Houston TX · Office", which is wrong for Los Angeles properties and for other types. Proposed patch for `frontend/src/components/workspace/PropertyPanel.tsx` (not applied):

```diff
-          {row.info.address}, Houston TX · Office · Class {row.info.propertyClass} · {row.info.id}
+          {row.info.address} · {row.info.propertyClass ? `Class ${row.info.propertyClass}` : "Class not recorded"} · {row.info.id}
...
-              ["Occupancy", `${row.info.occupancyPct}%`],
+              ["Occupancy", row.info.occupancyPct != null ? `${row.info.occupancyPct}%` : "Not recorded"],
```

These two changes pair with:

```ts
// types.ts (proposal)
export interface PropertyInfo {
  // ...
  propertyClass?: string;
  occupancyPct?: number;              // recorded tenant occupancy; absent when not supported by data
  missing?: Record<string, string>;   // field -> human-readable reason it is absent
}
```

## Parking: never mixed

| Frontend key | Source | Method | Notes |
|---|---|---|---|
| `surfaceSf` | Vexcel `elements/detect` | `model_estimate` (+ confidence) | area in sq ft; the only source for this key |
| `garageStalls` | none today | — | the kit records "Covered" spaces, which are **not** treated as garage stalls; interview only |
| *(dataset only)* `parking_spaces_surface` | CoStar kit | `computed` (sum of recorded counts) | CoStar-reported **count**, not area |
| *(dataset only)* `parking_spaces_covered` | CoStar kit | `computed` | covered ≠ garage |
