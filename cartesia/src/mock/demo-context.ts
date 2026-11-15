/**
 * MOCK TEST CONTEXT for the standalone demo only. Fictional property; not CoStar data.
 * The module itself is generic: any study passes its own ResearchContext.
 */
import type { ResearchContext } from "../types";

export const DEMO_CONTEXT: ResearchContext = {
  studyId: "demo-houston-ev-readiness",
  propertyId: "HOU-018",
  propertyName: "Houston Commerce Center",
  researchQuestion: "How prepared are Houston commercial properties for EV adoption?",
  participantRole: "Property manager",
  missingEvidence: [
    {
      key: "ev_chargers_present",
      label: "EV chargers present",
      description: "Whether the property has any EV charging stations today",
      type: "boolean",
      required: true,
    },
    {
      key: "current_charger_count",
      label: "Current charger count",
      description: "Number of EV charging stations (ports) installed today",
      type: "integer",
      required: true,
    },
    {
      key: "charger_accessibility",
      label: "Charger accessibility",
      description: "Who can use the chargers: public, tenants only, or restricted",
      type: "text",
      required: false,
    },
    {
      key: "expansion_planned",
      label: "Expansion planned",
      description: "Whether more chargers are planned",
      type: "boolean",
      required: true,
    },
    {
      key: "additional_chargers_planned",
      label: "Additional chargers planned",
      description: "How many additional chargers are planned",
      type: "integer",
      required: false,
    },
    {
      key: "expansion_timeline",
      label: "Expansion timeline",
      description: "When the additional chargers are expected",
      type: "text",
      required: false,
    },
  ],
  // Host-only context. Never sent to Cartesia (see prompt/interviewer.ts).
  knownContext: { source: "mock", note: "No CoStar data in the standalone demo." },
};
