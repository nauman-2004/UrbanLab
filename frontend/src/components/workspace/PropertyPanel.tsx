"use client";

import type { ReactNode } from "react";
import { deriveRow, fmt } from "@/lib/analysis";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Cell, PropertyRow, Source } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { SourceTag } from "../ui/Provenance";
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

/** "Inside and out" panel: CoStar facts + Vexcel aerial + Matterport + interview for one building. */
export function PropertyPanel({ row }: { row: PropertyRow | null }) {
  const { state } = useStudy();
  if (!row) {
    return (
      <div className="grid w-full shrink-0 place-items-center border-line p-6 text-center text-xs text-dim xl:w-[340px] xl:border-l">
        Select a building to inspect its CoStar record, aerial measurement and 3D scan.
      </div>
    );
  }
  const c = row.cells;
  const d = deriveRow(row);
  const gap = state.gaps.find((g) => g.propertyId === row.info.id);
  const garage: Cell | undefined = c.garageStalls;
  const off = c.offsiteSpaces;

  return (
    <aside className="scrollbar-thin flex w-full shrink-0 flex-col overflow-y-auto border-line bg-[#121734] xl:w-[340px] xl:border-l" aria-label={`${row.info.name} details`}>
      <AerialTile row={row} />
      <div className="px-3 pt-2 pb-1.5">
        <b className="text-[15px]">{row.info.name}</b>
        <div className="text-[11.5px] text-muted">
          {row.info.address}, Houston TX · Office · Class {row.info.propertyClass} · {row.info.id}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
        <Layer source="costar" meta={`property #${row.info.costarId}`}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
            {[
              ["Year built", c.yearBuilt ? String(c.yearBuilt.value) : "—"],
              ["RBA", c.rbaSf ? `${(c.rbaSf.value / 1e6).toFixed(2)}M sf` : "—"],
              ["Lot", c.lotSf ? `${fmt.int(c.lotSf.value)} sf` : "—"],
              ["Occupancy", `${row.info.occupancyPct}%`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </Layer>

        <Layer source="vexcel" meta={c.surfaceSf ? `~${fmt.int(d.surfaceStalls)} stalls` : undefined}>
          <div className="flex items-baseline justify-between text-[11.5px]">
            <span className="text-muted">Surface parking</span>
            {c.surfaceSf ? (
              <span>
                <Big className="text-vexcel">{fmt.int(c.surfaceSf.value)} sf</Big>
                <span className="ml-1 font-mono text-muted">· {fmt.pct(d.surfaceRatio)} of lot</span>
              </span>
            ) : (
              <Pending />
            )}
          </div>
        </Layer>

        <Layer
          source={garage?.source === "costar" ? "costar" : "matterport"}
          meta={garage ? (garage.source === "matterport" ? `${garage.evidence.ref} · ${garage.evidence.note}` : "no 3D scan · inferred") : undefined}
        >
          <div className="flex items-baseline justify-between text-[11.5px]">
            <span className="text-muted">Structured garage stalls</span>
            {garage ? <Big className={garage.source === "matterport" ? "text-mport" : "text-costar"}>{fmt.int(garage.value)}</Big> : <Pending />}
          </div>
          {garage?.source === "costar" && <p className="mt-0.5 text-[10.5px] text-dim">{garage.evidence.note}</p>}
          {row.info.matterportUrl && (
            <a href={row.info.matterportUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-mport hover:underline">
              Open 3D tour <Icon name="external" className="size-3" />
            </a>
          )}
        </Layer>

        {off?.source === "interview" ? (
          <Layer source="interview" tone="voice" meta={off.evidence.ref}>
            <div className="flex items-start justify-between gap-2 text-[11.5px]">
              <div>
                <span className="text-muted">Off-site leased spaces</span>
                <div className={off.verification === "unverified" ? "unverified-ring mt-0.5 inline-block rounded px-1.5" : "mt-0.5"}>
                  <Big className="text-voice">{fmt.int(off.value)}</Big>
                </div>
              </div>
              <VerifyControl propertyId={row.info.id} variable="offsiteSpaces" cell={off} />
            </div>
            {off.evidence.quote && <p className="mt-1 text-[10.5px] text-muted italic">“{off.evidence.quote}”</p>}
          </Layer>
        ) : off ? (
          <Layer source="costar" meta="parking notes">
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted">Off-site leased spaces</span>
              <Big className="text-costar">{fmt.int(off.value)}</Big>
            </div>
          </Layer>
        ) : gap ? (
          <Layer source="interview" tone="gap" meta={gap.status === "collecting" ? "calling now…" : gap.status}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted">Off-site leased spaces</span>
              <span className="font-semibold text-gap">MISSING</span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-muted">{gap.reason}</p>
          </Layer>
        ) : null}

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
