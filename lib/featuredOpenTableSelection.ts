/**
 * The one upcoming night empty Social may feature. Null until the captain
 * approves a real hosted night, and a selection lands in its own reviewed
 * change. Every field must match the live crew, or Social keeps its general
 * crawl link. `meetingVenueId` is the canonical London pub id.
 */
export type FeaturedOpenTableSelection = {
  crewId: string;
  hostHandle: string;
  meetingVenueId: string;
  startsAt: string;
};

export const FEATURED_OPEN_TABLE_SELECTION: FeaturedOpenTableSelection | null = null;
