// Sort My Night P1 — occasion templates. Pre-shaped plan titles + concierge
// seed queries so crews start from a job ("watch the match") instead of a blank
// form. Pure data; PlanComposer applies them into draft fields.

export type PlanTemplate = {
  id: string;
  label: string;
  title: string;
  /** Prefills the concierge "Suggest a crawl" box. */
  conciergeQuery: string;
  blurb: string;
};

export const PLAN_TEMPLATES: readonly PlanTemplate[] = [
  {
    id: "watch-the-match",
    label: "Watch the match",
    title: "Match night",
    conciergeQuery: "pubs screening live sport tonight near me",
    blurb: "Screens + a pint before kick-off.",
  },
  {
    id: "leaving-do",
    label: "Leaving do",
    title: "Leaving do",
    conciergeQuery: "lively central pubs for a leaving do of 8",
    blurb: "A short, sociable loop for the send-off.",
  },
  {
    id: "birthday-ten",
    label: "Birthday for 10",
    title: "Birthday round",
    conciergeQuery: "roomy pubs good for a birthday of about 10",
    blurb: "Space for the group without a booking war.",
  },
  {
    id: "quiz-night",
    label: "Quiz night",
    title: "Quiz night",
    conciergeQuery: "pub quiz tonight near me",
    blurb: "Timed quiz rows from the What's-On spine.",
  },
  {
    id: "cheap-round",
    label: "Cheap round",
    title: "Cheap round tonight",
    conciergeQuery: "deal nights and cheap pints tonight",
    blurb: "Deal days + honest pint prices.",
  },
  {
    id: "client-dinner",
    label: "Client dinner",
    title: "Client dinner",
    conciergeQuery: "quieter gastropubs good for a client dinner",
    blurb: "Calmer rooms, proper food, easy exit.",
  },
] as const;

export function planTemplateById(id: string): PlanTemplate | null {
  return PLAN_TEMPLATES.find((t) => t.id === id) ?? null;
}
