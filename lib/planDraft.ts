export const PLAN_DRAFT_KEY = "pubmaxx:plan-draft:v1";

export type StoredPlanDraft = {
  title: string;
  creatorName: string;
  startTime: string;
  conciergeQuery: string;
  stops: Array<{ key: number; venueId: string; venueName: string }>;
};

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value : null;

export function parsePlanDraft(raw: string | null): StoredPlanDraft | null {
  if (!raw || raw.length > 20_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredPlanDraft>;
    const title = text(value.title, 200);
    const creatorName = text(value.creatorName, 100);
    const startTime = text(value.startTime, 40);
    const conciergeQuery = text(value.conciergeQuery, 500);
    if (title === null || creatorName === null || startTime === null || conciergeQuery === null) return null;
    if (!Array.isArray(value.stops) || value.stops.length < 1 || value.stops.length > 12) return null;
    const stops = value.stops.map((stop, index) => {
      const venueId = text(stop?.venueId, 200);
      const venueName = text(stop?.venueName, 200);
      if (venueId === null || venueName === null) return null;
      return { key: index + 1, venueId, venueName };
    });
    if (stops.some((stop) => stop === null)) return null;
    return { title, creatorName, startTime, conciergeQuery, stops: stops as StoredPlanDraft["stops"] };
  } catch {
    return null;
  }
}
