"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { STUDY } from "@/lib/data/houston";
import { useStudy } from "@/lib/state/StudyProvider";
import { Icon, type IconName } from "../ui/Icon";
import { studyAreaLabel } from "../workspace/StudyMap";
import { IntegrationBar } from "./IntegrationBar";
import { SUPPORTED_SCOPE } from "./QuestionBar";
import { QuestionBar } from "./QuestionBar";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Workspace", icon: "search" },
  { href: "/findings", label: "Findings", icon: "report" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { start, status, state } = useStudy();
  const area = studyAreaLabel(state.order.map((id) => state.rows[id].info));
  const title = pathname.startsWith("/findings") ? "Findings Report" : "Research Workspace";

  return (
    <div className="flex min-h-dvh xl:h-dvh">
      {/* Rail (md+) */}
      <nav aria-label="Primary" className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center gap-2 border-r border-line bg-rail py-3.5 md:flex">
        <div className="mb-3.5 grid size-9 place-items-center rounded-[10px] bg-gradient-to-br from-accent to-indigo-500 shadow-[0_6px_18px_#8b5cf655]">
          <Icon name="logo" className="size-[18px] text-white" />
        </div>
        {NAV.map((n) => {
          const on = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-label={n.label}
              title={n.label}
              aria-current={on ? "page" : undefined}
              className={`grid size-10 place-items-center rounded-[10px] transition ${on ? "bg-accent/15 text-accent2 shadow-[inset_0_0_0_1px_#8b5cf655]" : "text-dim hover:text-ink"}`}
            >
              <Icon name={n.icon} className="size-[19px]" />
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col xl:min-h-0">
        <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 pt-3 pb-2 md:px-5">
          <h1 className="text-lg font-bold tracking-tight">{title}</h1>
          <span className="hidden text-xs text-dim sm:inline">/ {area || SUPPORTED_SCOPE} · {state.studyId ?? STUDY.id}</span>
          <div className="flex-1" />
          <nav aria-label="Views" className="flex gap-1.5">
            {NAV.map((n) => {
              const on = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-[9px] border px-3 py-1.5 text-[12.5px] font-medium transition ${on ? "border-accent2/50 bg-accent/15 text-ink" : "border-line2 text-muted hover:text-ink"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => start()}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_#7c3aed44] hover:brightness-110"
          >
            {status === "idle" ? "＋ New Research" : "↻ Restart study"}
          </button>
        </header>

        <div className="px-4 md:px-4">
          <QuestionBar />
        </div>

        <main className="flex min-h-0 flex-1 flex-col xl:overflow-y-auto">{children}</main>
        <IntegrationBar />
      </div>
    </div>
  );
}
