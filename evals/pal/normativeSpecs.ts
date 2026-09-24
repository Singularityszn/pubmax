import type { PalEvalPublicCase } from "./types";

type PalEvalNormativeCall = {
  tool: string;
  args?: Record<string, unknown>;
};

export type PalEvalNormativeSpec =
  | { calls: PalEvalNormativeCall[] }
  | { empty: true };

export function normativeSpecForCase(
  caseDef: PalEvalPublicCase,
): PalEvalNormativeSpec | null {
  const query = caseDef.query;
  switch (caseDef.id) {
    case "cheapest-camden":
      return { calls: [{ tool: "cheapest_pint_near", args: { area: "Camden", limit: 4 } }] };
    case "quiz-camden":
    case "quiz-islington":
    case "football-whats-on":
      return { calls: [{ tool: "whats_on", args: { query } }] };
    case "manchester-outscope":
    case "paris-outscope":
      return { calls: [{ tool: "search_venues", args: { query, limit: 4 } }] };
    case "cheapest-near-lamb":
      return { calls: [{ tool: "cheapest_pint_near", args: { venueName: "The Lamb", limit: 4 } }] };
    case "venue-drinks-lamb":
      return { calls: [{ tool: "venue_drinks", args: { venueName: "The Lamb" } }] };
    case "quiet-bank":
    case "hampstead-quiet":
    case "non-alcoholic-soho":
    case "food-midnight-covent":
      return { calls: [{ tool: "search_venues", args: { query, limit: 4 } }] };
    case "plan-soho":
      return { calls: [{ tool: "propose_plan", args: { query } }] };
    case "tube-delays":
      return { calls: [{ tool: "city_status", args: { query } }] };
    case "find-desk-angel":
      return { calls: [{ tool: "find_desk", args: { query } }] };
    case "tonight-soho":
      return { calls: [{ tool: "tonight_now", args: { query, area: "Soho" } }] };
    case "cheapest-no-anchor":
    case "wine-lamb-honest":
    case "dearest-soho-honest":
      return { calls: [{ tool: "venue_prices", args: { query } }] };
    case "heritage-lamb":
    case "heritage-bank":
      return {
        calls: [
          {
            tool: "venue_heritage",
            args: {
              venueName:
                caseDef.id === "heritage-lamb" ? "The Lamb" : "The Old Bank of England",
              query,
            },
          },
        ],
      };
    case "map-open-lamb":
    case "open-map-bank":
      return {
        calls: [
          {
            tool: "propose_map_action",
            args: {
              venueName:
                caseDef.id === "map-open-lamb" ? "The Lamb" : "The Old Bank of England",
              query,
            },
          },
        ],
      };
    case "area-buzz-camden":
      return {
        calls: [
          { tool: "area_buzz", args: { area: "Camden", query } },
          { tool: "venue_prices", args: { query } },
        ],
      };
    case "report-crowd-lamb":
    case "no-seats-lamb":
      return { calls: [{ tool: "report_occupancy", args: { venueName: "The Lamb", query } }] };
    case "journey-lamb":
      return { calls: [{ tool: "journey", args: { query } }] };
    case "followup-cheaper-camden":
      return { calls: [{ tool: "search_venues", args: { query: "cheaper in Camden", limit: 4 } }] };
    case "desk-then-cheapest":
      return { calls: [{ tool: "cheapest_pint_near", args: { area: "Camden", limit: 4 } }] };
    case "crawl-refine-cheaper":
      return { calls: [{ tool: "propose_plan", args: { query: "Plan a crawl in Soho for 4" } }] };
    default:
      return null;
  }
}
