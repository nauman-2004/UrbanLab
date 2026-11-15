"use client";

import { useState } from "react";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Cell, CellScalar, VariableKey } from "@/lib/types";
import { VerificationBadge } from "../ui/Provenance";

const EVIDENCE = ["Parking lease agreement", "Parking operator invoice", "Site visit / permit count"];

/**
 * Interview values are self-reported, so they stay UNVERIFIED until a
 * researcher records independent evidence. This control is the only way to
 * change that status (in live mode it sends a `cell.verify` command).
 */
export function VerifyControl({ propertyId, variable, cell }: { propertyId: string; variable: VariableKey; cell: Cell<CellScalar> }) {
  const { verify } = useStudy();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(EVIDENCE[0]);

  if (cell.verification !== "unverified") return <VerificationBadge verification={cell.verification} />;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <VerificationBadge verification="unverified" />
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="text-[10.5px] font-semibold text-accent2 hover:underline">
            Verify…
          </button>
        )}
      </div>
      {open && (
        <form
          className="flex w-full flex-wrap items-center justify-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            verify(propertyId, variable, choice);
            setOpen(false);
          }}
        >
          <label className="sr-only" htmlFor={`ev-${propertyId}`}>
            Independent evidence
          </label>
          <select
            id={`ev-${propertyId}`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="rounded-md border border-line2 bg-well px-1.5 py-1 text-[11px] text-soft"
          >
            {EVIDENCE.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-voice px-2 py-1 text-[11px] font-semibold text-[#06281c]">
            Confirm
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted hover:text-ink">
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
