"use client";

import type { ReactNode } from "react";
import { deriveRow, fmt } from "@/lib/analysis";
import { useStudy } from "@/lib/state/StudyProvider";
import { varLabel } from "@/lib/state/reducer";
import type { Cell, CellScalar, Gap, PropertyRow, Source } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { formatValue, MethodBadge, NOT_AVAILABLE, SourceTag } from "../ui/Provenance";
import { AerialTile } from "./AerialTile";
import { VerifyControl } from "./VerifyControl";

function Layer({ source, meta, children, tone }: { source: Source; meta?: ReactNode; children: ReactNode; tone?: "voice" | "gap" }) {
  const toneCls = tone === "voice" ? "border-voice/40 bg-voice/[0.05]" : tone === "gap" ? "border-gap/40 hatch-gap" : "border-line bg-[#0e1229]";
  return (
    <div className={`rounded-[10px] border px-2.5 py-2 ${toneCls}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <SourceTag source={source} />
        {meta && <span className="truncate font-mono text-[10px] text-dim">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

const Big = ({ children, className }: { children: ReactNode; className: string }) => <span className={`font-mono text-lg font-semibold ${className}`}>{children}</span>;

const Pending = () => <span className="font-mono text-xs text-dim">pending…</span>;

/** Explicit missing-data state. The reason (when known) is available on hover and to screen readers. */
const Missing = ({ reason }: { reason?: string }) => (
  <span className="font-mono text-xs text-gap" title={reason}>
    {NOT_AVAILABLE}
    {reason && <span className="sr-only"> — {reason}</span>}
  </span>
);

/** Variables rendered by the dedicated layers below; everything else goes to "Other variables". */
const SHOWN = new Set(["yearBuilt", "rbaSf", "lotSf", "surfaceSf", "garageStalls", "offsiteSpaces",
  "parking_spaces_surface", "parking_spaces_covered", "parking_spaces", "occupancy_pct", "building_class", "property_type"]);

/** "Inside and out" panel: CoStar facts + Vexcel aerial + Matterport + interview for one property. */
export function PropertyPanel({ row }: { row: PropertyRow | null }) {
  const { state, status } = useStudy();
  if (!row) {
    return (
      <div className="grid w-full shrink-0 place-items-center border-line p-6 text-center text-xs text-dim xl:w-[340px] xl:border-l">
        Select a property to inspect its CoStar record, aerial measurement and 3D scan.
      </div>
    );
  }
  const c = row.cells;
  const d = deriveRow(row);
  const info = row.info;
  const finished = status === "done" || state.reportDraft != null;
  const gapFor = (variable: string): Gap | undefined =>
    state.gaps.find((g) => g.propertyId === info.id && g.variable === variable && g.status !== "filled");
  /** Value text, explicit "Not available" (gap or finished study), or pending. */
  const show = (variable: string, cell: Cell<CellScalar> | undefined, format?: (n: number) => string): ReactNode => {
    if (cell) return formatValue(cell.value, format);
    const gap = gapFor(variable);
    if (gap || finished) return <Missing reason={gap?.reason} />;
    return "—";
  };
  const garage: Cell | undefined = c.garageStalls;
  const garageGap = gapFor("garageStalls");
  const off = c.offsiteSpaces;
  const offGap = gapFor("offsiteSpaces");
  const surfaceGap = gapFor("surfaceSf");
  const reported = [
    ["Surface spaces", "parking_spaces_surface"],
    ["Covered spaces", "parking_spaces_covered"],
    ["Total spaces", "parking_spaces"],
  ].filter(([, k]) => c[k]);
  const place = info.city ? (info.state ? `${info.city}, ${info.state}` : info.city) : undefined;
  const subtitle = [info.address, place, info.propertyType, info.propertyClass ? `Class ${info.propertyClass}` : undefined, info.id]
    .filter(Boolean)
    .join(" · ");
  const planLabel = (k: string) => state.plan?.variables.find((v) => v.key === k)?.label ?? varLabel(k);
  const others = [
    ...Object.keys(c).filter((k) => !SHOWN.has(k)),
    ...state.gaps.filter((g) => g.propertyId === info.id && !SHOWN.has(g.variable) && !c[g.variable]).map((g) => g.variable),
  ].filter((k, i, a) => a.indexOf(k) === i);

  return (
    <aside className="scrollbar-thin flex w-full shrink-0 flex-col overflow-y-auto border-line bg-[#121734] xl:w-[340px] xl:border-l" aria-label={`${info.name} details`}>
      <AerialTile row={row} />
      <div className="px-3 pt-2 pb-1.5">
        <b className="text-[15px]">{info.name}</b>
        <div className="text-[11.5px] text-muted">{subtitle}</div>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
        <Layer source="costar" meta={`property #${info.costarId}`}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
            {(
              [
                ["Year built", show("yearBuilt", c.yearBuilt, String)],
                ["RBA", show("rbaSf", c.rbaSf, (n) => `${(n / 1e6).toFixed(2)}M sf`)],
                ["Lot", show("lotSf", c.lotSf, (n) => `${fmt.int(n)} sf`)],
                [
                  "Occupancy",
                  info.occupancyPct != null ? (
                    <span title="Recorded tenant occupancy (occupied SF of current tenancies / RBA). Not a vacancy rate.">{info.occupancyPct}%</span>
                  ) : (
                    <Missing reason={info.missing?.occupancyPct ?? "No recorded occupancy figure for this property"} />
                  ),
                ],
              ] as [string, ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          {reported.length > 0 && (
            <div className="mt-1.5 border-t border-line pt-1.5">
              <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-dim">PARKING · CoStar-reported counts (not imagery)</div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
                {reported.map(([label, k]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-mono">{formatValue(c[k]!.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Layer>

        <Layer source="vexcel" meta={c.surfaceSf ? `~${fmt.int(d.surfaceStalls)} stalls at assumed sf/stall` : undefined}>
          <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
            <span className="flex items-center gap-1.5 text-muted">
              Surface parking area {c.surfaceSf && <MethodBadge cell={c.surfaceSf} />}
            </span>
            {c.surfaceSf ? (
              <span>
                <Big className="text-vexcel">{fmt.int(c.surfaceSf.value)} sf</Big>
                {d.surfaceRatio != null && <span className="ml-1 font-mono text-muted">· {fmt.pct(d.surfaceRatio)} of lot</span>}
              </span>
            ) : surfaceGap || finished ? (
              <Missing reason={surfaceGap?.reason} />
            ) : (
              <Pending />
            )}
          </div>
        </Layer>

        {garage ? (
          <Layer
            source={garage.source}
            meta={garage.source === "matterport" ? `${garage.evidence.ref} · ${garage.evidence.note}` : garage.evidence.ref}
          >
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                Structured garage stalls <MethodBadge cell={garage} />
              </span>
              <Big className={garage.source === "matterport" ? "text-mport" : garage.source === "interview" ? "text-voice" : "text-costar"}>{fmt.int(garage.value)}</Big>
            </div>
            {garage.source === "costar" && garage.evidence.note && <p className="mt-0.5 text-[10.5px] text-dim">{garage.evidence.note}</p>}
          </Layer>
        ) : garageGap || finished ? (
          <Layer source="costar" tone="gap" meta={garageGap?.status}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted">Structured garage stalls</span>
              <span className="font-semibold text-gap">{NOT_AVAILABLE}</span>
            </div>
            {garageGap && <p className="mt-0.5 text-[10.5px] text-muted">{garageGap.reason}</p>}
          </Layer>
        ) : (
          <Layer source="matterport">
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted">Structured garage stalls</span>
              <Pending />
            </div>
          </Layer>
        )}

        {info.matterportUrl && (
          <Layer source="matterport" meta="linked scan · may cover one suite or unit">
            <a href={info.matterportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10.5px] text-mport hover:underline">
              Open 3D tour <Icon name="external" className="size-3" />
            </a>
          </Layer>
        )}

        {off?.source === "interview" ? (
          <Layer source="interview" tone="voice" meta={off.evidence.ref}>
            <div className="flex items-start justify-between gap-2 text-[11.5px]">
              <div>
                <span className="text-muted">Off-site leased spaces</span>
                <div className={off.verification === "unverified" ? "unverified-ring mt-0.5 inline-block rounded px-1.5" : "mt-0.5"}>
                  <Big className="text-voice">{fmt.int(off.value)}</Big>
                </div>
              </div>
              <VerifyControl propertyId={info.id} variable="offsiteSpaces" cell={off} />
            </div>
            {off.evidence.quote && <p className="mt-1 text-[10.5px] text-muted italic">“{off.evidence.quote}”</p>}
          </Layer>
        ) : off ? (
          <Layer source={off.source} meta={off.evidence.ref}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                Off-site leased spaces <MethodBadge cell={off} />
              </span>
              <Big className="text-costar">{fmt.int(off.value)}</Big>
            </div>
          </Layer>
        ) : offGap ? (
          <Layer source="interview" tone="gap" meta={offGap.status === "collecting" ? "calling now…" : offGap.status}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted">Off-site leased spaces</span>
              <span className="font-semibold text-gap">MISSING</span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-muted">{offGap.reason}</p>
          </Layer>
        ) : null}

        {others.length > 0 && (
          <div className="rounded-[10px] border border-line bg-[#0e1229] px-2.5 py-2">
            <div className="mb-1 text-[10px] font-semibold tracking-wide text-dim">OTHER VARIABLES IN THIS STUDY</div>
            <dl className="flex flex-col gap-0.5 text-[11.5px]">
              {others.map((k) => {
                const cell = c[k];
                return (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <dt className="truncate text-muted" title={cell ? `${cell.evidence.ref}${cell.evidence.note ? ` — ${cell.evidence.note}` : ""}` : undefined}>
                      {planLabel(k)}
                    </dt>
                    <dd className="flex items-center gap-1.5 font-mono">
                      {cell && <MethodBadge cell={cell} />}
                      {show(k, cell)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        {d.complete && (
          <div className="flex items-center justify-between rounded-[10px] border border-line px-2.5 py-1.5 text-[11.5px]">
            <span className="text-muted">Total supply</span>
            <span className="font-mono">
              {fmt.int(d.totalStalls)} stalls · <b className="text-ink">{fmt.dec(d.stallsPer1k)}</b> / 1k sf
              {d.unverified && <span className="ml-1 text-unverified" title="Includes an unverified self-reported value">⚠</span>}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
