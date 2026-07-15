import { jsonNoStore } from "@/lib/apiResponses";
import {
  getLateFoodForArea,
  LATE_FOOD_AREAS,
  normalizeLateFoodArea,
  type LateFoodApiErrorResponse,
  type LateFoodApiSuccessResponse,
} from "@/lib/lateFood";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function parseTags(raw: string | null): string[] {
  return raw?.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 8) ?? [];
}

// GET /api/late-food?near=clapham&at=late_night&tags=kebab,halal&limit=6
//
// Keyless curated crawl endings. These are food terminals rather than PUBMAXX
// Venue Dataset rows, so they are never fed into pint-price route generation.
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const area = normalizeLateFoodArea(params.get("near") ?? params.get("area"));
  const tags = parseTags(params.get("tags"));
  if (!area) {
    const body: LateFoodApiErrorResponse = {
      error: `near must be one of ${LATE_FOOD_AREAS.join(", ")}.`,
      terminals: [],
    };
    return jsonNoStore(body, { status: 400 });
  }

  const body: LateFoodApiSuccessResponse = {
    area,
    terminals: getLateFoodForArea(area, tags).slice(0, parseLimit(params.get("limit"))),
    rankingSignals: ["night_area", "category_or_dietary_tags", "walking_detour", "editorial_confidence"],
    missingEvidence: ["live_opening_hours", "hygiene_rating", "terminal_coordinates"],
  };
  return jsonNoStore(body);
}
