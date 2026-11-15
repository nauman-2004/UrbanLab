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
