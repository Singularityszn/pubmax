import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const VIEWER_COORDINATE_EGRESS_FILES = [
  "components/map/useWhatsOnTonight.ts",
  "app/tonight/TonightConditionsStrip.tsx",
  "app/tonight/TonightGetHomeStrip.tsx",
  "app/today/TodayGetThereStrip.tsx",
  "app/today/TodayTubeCard.tsx",
  "components/transport/DisruptionLine.tsx",
  "components/map/useVenueJourney.ts",
  "lib/venueJourney.ts",
  "lib/lastTrainDestination.ts",
  "lib/whatsOnHandler.ts",
  "app/api/tonight-conditions/route.ts",
  "app/api/tfl-disruption/route.ts",
  "app/api/citymcp/journey/route.ts",
  "lib/lastTrain.server.ts",
  // The locate fix reaches a URL (server logs, history, shareable), so it
  // must coarsen before it leaves the browser (#901 review finding).
  "lib/locateMapDestination.ts",
] as const;

describe("viewer coordinate egress", () => {
  it.each(VIEWER_COORDINATE_EGRESS_FILES)(
    "%s passes coordinates through the shared coarsening seam",
    (file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toMatch(/coarsenViewerPoint\s*\(/);
    },
  );
});

// The other side of the same seam. These modules hold the reader's own live
// fix, so the law for them is not "coarsen before it leaves" but "it never
// leaves": no network door, no analytics, no URL, no storage, no log line and
// nothing handed to the resume viewport the map writes on every idle.
// The map dot is painted from them (lib/mapReaderPosition.ts, #1724).
const VIEWER_COORDINATE_NO_EGRESS_FILES = [
  "lib/mapReaderPosition.ts",
  "lib/mapReaderPositionWatch.ts",
  "components/map/useMapReaderPosition.ts",
  "components/map/canvas/readerPositionProbe.ts",
] as const;

const NO_EGRESS_DOORS: ReadonlyArray<readonly [string, RegExp]> = [
  ["fetch", /\bfetch\s*\(/],
  ["sendBeacon", /\bnavigator\.sendBeacon\s*\(/],
  ["an API path", /["'`]\/api\//],
  ["analytics", /\b(trackEvent|posthog|analytics)\b/i],
  ["a URL", /\b(URLSearchParams|history\.(push|replace)State)\b/],
  ["storage", /\b(localStorage|sessionStorage)\b/],
  ["a log line", /\bconsole\.\w+\s*\(/],
  ["the resume viewport", /\bwriteMapResume\s*\(/],
  ["the opening-location store", /\bwriteMapOpeningLocation\s*\(/],
];

describe("viewer coordinates that never leave the browser", () => {
  it.each(VIEWER_COORDINATE_NO_EGRESS_FILES)("%s opens no door at all", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    for (const [door, pattern] of NO_EGRESS_DOORS) {
      expect(source, `${file} reaches ${door}`).not.toMatch(pattern);
    }
  });

  it("neither list claims the same file", () => {
    for (const file of VIEWER_COORDINATE_NO_EGRESS_FILES) {
      expect(VIEWER_COORDINATE_EGRESS_FILES as readonly string[]).not.toContain(file);
    }
  });
});
