"use client";

import { useStudy } from "@/lib/state/StudyProvider";
import { Card, CardHeader } from "../ui/Card";
import { AgentActivity } from "./AgentActivity";
import { ApprovalModal } from "./ApprovalModal";
import { DatasetTable } from "./DatasetTable";
import { InterviewDrawer } from "./InterviewDrawer";
import { PropertyPanel } from "./PropertyPanel";
import { ResearchPlan } from "./ResearchPlan";
import { StudyMap, studyAreaLabel } from "./StudyMap";

export function Workspace() {
  const { state, selectedId } = useStudy();
  // The panel follows the agent's latest activity until the user picks a building.
  const activeId = selectedId ?? state.focusId ?? state.order[0] ?? null;
  const row = activeId ? state.rows[activeId] ?? null : null;
  const area = studyAreaLabel(state.order.map((id) => state.rows[id].info)) || "Study area";
  const n = state.order.length;

  return (
    <>
      <div className="grid flex-1 grid-cols-1 gap-3 px-4 py-3 xl:min-h-[600px] xl:grid-cols-[256px_minmax(0,1fr)_320px] xl:grid-rows-[minmax(0,1fr)_minmax(200px,32%)]">
        <div className="order-2 xl:order-none xl:min-h-0">
          <ResearchPlan />
        </div>

        <div className="order-1 xl:order-none xl:min-h-0">
          <Card className="h-full">
            <CardHeader icon="pin" title={`${area} · ${n} ${n === 1 ? "property" : "properties"}`} aside="select a property to inspect all layers" />
            <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
              <div className="flex h-[300px] xl:h-auto xl:flex-1">
                <StudyMap activeId={activeId} />
              </div>
              <PropertyPanel row={row} />
            </div>
          </Card>
        </div>

        <div className="order-3 h-[420px] xl:order-none xl:h-auto xl:min-h-0">
          <AgentActivity />
        </div>

        <div className="order-4 h-[360px] xl:col-span-3 xl:h-auto xl:min-h-0">
          <DatasetTable activeId={activeId} />
        </div>
      </div>
      <ApprovalModal />
      <InterviewDrawer />
    </>
  );
}
