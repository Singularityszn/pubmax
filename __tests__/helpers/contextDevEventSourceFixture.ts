import type { HarvestSource } from "@/lib/harvest/sourcePolicy";

// The register holds no allowed first-party venue-events page, so the Context.dev
// lane tests grant this one to drive the lane past its empty-register exit.
export const PUBCO_EVENTS_SOURCE: HarvestSource = {
  id: "example-pubco-events",
  label: "Example Pub Co",
  url: "https://www.example-pubco.co.uk/event-finder",
  kind: "venue-events",
  firstParty: true,
  access: { allowed: true, evidence: "Test fixture.", checkedOn: "2026-11-12" },
  notes: "Test fixture for the Context.dev events lane.",
};
