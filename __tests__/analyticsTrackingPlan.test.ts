import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  MISSION_OUTCOMES,
  VENUE_SHEET_LAYERS,
  sanitizeEvent,
} from "@/lib/analyticsEvents";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

const TRACKING_PLAN = read("docs/analytics/TRACKING_PLAN.md");
const DASHBOARD = JSON.parse(read("docs/analytics/weekly-dashboard.json")) as {
  dashboard: { name: string; description: string };
  prerequisite_action: { steps: { event: string }[] };
  insights: { name: string; description: string; query: unknown }[];
};

/** Every event name the dashboard's queries mention, wherever they mention it. */
function dashboardEventNames(): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "event" && typeof value === "string") found.add(value);
      else walk(value);
    }
  };
  walk(DASHBOARD);
  // The HogQL tile names its events inside a SQL string rather than as a key.
  for (const name of Object.keys(ANALYTICS_EVENTS)) {
    if (JSON.stringify(DASHBOARD).includes(`'${name}'`)) found.add(name);
  }
  return [...found];
}

describe("venue_sheet_opened (release funnel, step 3)", () => {
  it("registers the pub layer and nothing else", () => {
    expect(ANALYTICS_EVENTS.venue_sheet_opened).toEqual(["layer"]);
    expect(VENUE_SHEET_LAYERS).toEqual(["curated", "uk_base"]);
  });

  it("keeps both layers and drops every identifying prop", () => {
    for (const layer of VENUE_SHEET_LAYERS) {
      expect(
        sanitizeEvent("venue_sheet_opened", {
          layer,
          venueId: "venue-uk-123",
          venueName: "The Private Arms",
          handle: "night_owl",
          latitude: 51.5,
          longitude: -0.1,
          priceGbp: 4.5,
        }),
      ).toEqual({ name: "venue_sheet_opened", props: { layer } });
    }
  });

  it("fails closed on a missing or invented layer", () => {
    expect(sanitizeEvent("venue_sheet_opened", {})).toBeNull();
    expect(sanitizeEvent("venue_sheet_opened", { venueId: "venue-1" })).toBeNull();
    // "pending" is in the shared string allow-list for Wanted; it is not a layer.
    expect(sanitizeEvent("venue_sheet_opened", { layer: "pending" })).toBeNull();
    expect(sanitizeEvent("venue_sheet_opened", { layer: "curated pub" })).toBeNull();
  });

  it("is emitted through the one hook, by both Map sheets and nobody else", () => {
    const hook = read("components/map/useVenueSheetOpened.ts");
    expect(hook).toMatch(/trackEvent\(\s*"venue_sheet_opened"/);

    const curated = read("components/map/VenueInspector.tsx");
    expect(curated).toContain("useVenueSheetOpened(venue.id, \"curated\")");
    const base = read("components/map/UnverifiedPubSheet.tsx");
    expect(base).toContain("useVenueSheetOpened(pub.id, \"uk_base\")");

    // Neither sheet may keep a second copy of the once-per-venue guard.
    for (const source of [curated, base]) {
      expect(source).not.toMatch(/trackEvent\(\s*"venue_sheet_opened"/);
    }
  });
});

describe("price_submit_outcome (what a logged price turned out to be worth)", () => {
  it("registers the drink and the verdict only", () => {
    expect(ANALYTICS_EVENTS.price_submit_outcome).toEqual(["category", "outcome"]);
  });

  it("keeps the three read-back verdicts and drops the price itself", () => {
    for (const outcome of MISSION_OUTCOMES) {
      expect(
        sanitizeEvent("price_submit_outcome", {
          category: "beer",
          outcome,
          venueId: "venue-1",
          priceGbp: 4.5,
          handle: "night_owl",
        }),
      ).toEqual({ name: "price_submit_outcome", props: { category: "beer", outcome } });
    }
  });

  it("fails closed on a missing drink, a missing verdict, or an invented one", () => {
    expect(sanitizeEvent("price_submit_outcome", { category: "beer" })).toBeNull();
    expect(sanitizeEvent("price_submit_outcome", { outcome: "trusted" })).toBeNull();
    expect(
      sanitizeEvent("price_submit_outcome", { category: "beer", outcome: "confirmed" }),
    ).toBeNull();
    expect(
      sanitizeEvent("price_submit_outcome", { category: "lager tops", outcome: "trusted" }),
    ).toBeNull();
  });

  it("fires for every confirmed submission, not only inside a mission", () => {
    const source = read("components/map/VenuePriceSubmit.tsx");
    // The read-back is derived unconditionally, then the mission branch reuses
    // it. The `pintTrust` argument is pinned too (battle test D07): dropping it
    // would put the beer receipt back on community corroborations, which is the
    // reading that disagreed with the sheet's own head.
    expect(source).toMatch(
      /const readback = missionReceiptFromReadback\(\{[\s\S]{0,160}?pintTrust: result\.pintTrust,[\s\S]{0,40}?\}\);\s*\n\s*trackEvent\("price_submit_outcome", \{ category, outcome: readback\.outcome \}\);/,
    );
    expect(source).toContain("const missionReceipt = mission ? readback : undefined;");
  });
});

describe("the tracking plan document", () => {
  it("names every event in the registry", () => {
    const undocumented = Object.keys(ANALYTICS_EVENTS)
      .filter((name) => !TRACKING_PLAN.includes(`\`${name}\``));
    expect(undocumented, `undocumented registry events: ${undocumented.join(", ")}`)
      .toEqual([]);
  });

  it("catalogues no event the registry has dropped", () => {
    // The other direction, and it is the one that let the plan carry rows for
    // 18 names nothing sent. Only the section 5 CATALOGUE is read: section 6
    // names the deleted eighteen on purpose, in prose, so a reader knows what
    // went and why.
    const catalogue = TRACKING_PLAN.slice(
      TRACKING_PLAN.indexOf("## 5. The event catalogue"),
      TRACKING_PLAN.indexOf("## 6."),
    );
    const listed = [...catalogue.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((match) => match[1]);
    expect(listed.length).toBeGreaterThan(50);
    const unknown = listed.filter((name) => !(defined(name) in ANALYTICS_EVENTS));
    expect(unknown, `catalogued events the registry does not hold: ${unknown.join(", ")}`)
      .toEqual([]);
  });

  it("defines the release metric on the captain's two events and a 60 second window", () => {
    expect(TRACKING_PLAN).toContain("landing_cta_clicked");
    expect(TRACKING_PLAN).toContain("price_submitted");
    expect(TRACKING_PLAN).toMatch(/60 seconds/);
    expect(TRACKING_PLAN).toContain("discovery_viewed");
  });

  it("keeps a named owner action for each number on the weekly view", () => {
    for (const owner of ["Captain:", "Map owner:", "Price owner:", "Engineer on call:"]) {
      expect(TRACKING_PLAN).toContain(owner);
    }
  });
});

describe("the weekly dashboard definition", () => {
  it("carries the six numbers the weekly view is for", () => {
    expect(DASHBOARD.insights.map((insight) => insight.name)).toEqual([
      "1. Weekly active visitors",
      "2. First meaningful action within 60 seconds",
      "2b. First meaningful action funnel (60s window)",
      "3. Landing to Map to venue sheet",
      "4. Pint Drop submissions and corroboration",
      "5. Top routes by LCP (p75)",
      "6. The four loop moments",
    ]);
  });

  it("names only events the registry knows (a typo would read zero forever)", () => {
    const unknown = dashboardEventNames()
      .filter((name) => !name.startsWith("$"))
      .filter((name) => !(name in ANALYTICS_EVENTS));
    expect(unknown, `unknown event names in the dashboard: ${unknown.join(", ")}`)
      .toEqual([]);
  });

  it("holds the 60 second conversion window the release metric is defined on", () => {
    const funnel = JSON.stringify(DASHBOARD.insights[2]);
    expect(funnel).toContain('"funnelWindowInterval":60');
    expect(funnel).toContain('"funnelWindowIntervalUnit":"second"');
  });

  it("builds its funnel step from both of the captain's action events", () => {
    expect(DASHBOARD.prerequisite_action.steps.map((step) => step.event))
      .toEqual(["landing_cta_clicked", "price_submitted"]);
  });
});
