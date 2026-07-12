// Hand-maintained declarations for sportFixtures.mjs so the vitest suite
// (__tests__/whatsOnSportFixtures.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

export type SportFixture = {
  id: string;
  title: string;
  competition: string;
  venue: string;
  kickoffLondonDate: string;
  kickoffLondonTime: string;
  source: { label: string; url: string };
};

export declare const SPORT_FIXTURES: SportFixture[];

export type SportAttributeRow = {
  id?: string;
  venueId?: string;
  placeName?: string;
  lat?: number;
  lng?: number;
  kind?: string;
  title?: string;
  detail?: string;
  source?: { label?: string; url?: string };
  observedAt?: string;
  confidence?: string;
};

export type WhatsOnDerivedSportRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: "sport";
  startsAt: string;
  title: string;
  detail: string;
  source: { label: string; url: string };
  observedAt: string;
  confidence: "derived";
};

export declare function londonWallClockToIso(dateStr: unknown, timeStr: unknown): string | null;

export declare function buildSportFixtureRows(input: {
  attributeRows: SportAttributeRow[];
  fixtures: SportFixture[];
  observedAt: string;
}): WhatsOnDerivedSportRow[];
