import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  LOOP_MOMENT_EVENTS,
  MISSION_OUTCOMES,
  VENUE_SHEET_LAYERS,
  sanitizeEvent,
} from "@/lib/analyticsEvents";

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

describe("the no-emitter list (plan section 6)", () => {
  // The same literal-call sweep __tests__/loopMomentEvents.test.ts runs for the
  // six loop moments, widened to every registered name: section 6 of the plan
  // is the promise that these events read zero forever, so a name drifting in
  // either direction (registered but never sent and not listed, or listed
  // while an emitter exists) is a finding a dashboard cannot tell from the
  // truth.
  const EMITTER_PATTERNS = [
    /trackEvent\(\s*(['"`])([a-z_0-9]+)\1/g,
    /useLoopMoment\(\s*(['"`])([a-z_0-9]+)\1/g,
  ];

  function emittedNames(): Set<string> {
    const found = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const relative = join(dir, entry);
        if (statSync(join(ROOT, relative)).isDirectory()) {
          walk(relative);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const source = read(relative);
          for (const pattern of EMITTER_PATTERNS) {
            for (const match of source.matchAll(pattern)) found.add(match[2]);
          }
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);
    return found;
  }

  /** The names section 6 lists, narrowed to names the registry actually has. */
  function planNoEmitterNames(): string[] {
    const section = TRACKING_PLAN.slice(
      TRACKING_PLAN.indexOf("## 6. Registered with no emitter today"),
      TRACKING_PLAN.indexOf("## 7."),
    );
    return [...new Set(
      [...section.matchAll(/`([a-z_0-9]+)`/g)]
        .map((match) => match[1])
        .filter((name) => name in ANALYTICS_EVENTS),
    )];
  }

  it("names exactly the registered events nothing in app, components or lib emits", () => {
    const emitted = emittedNames();
    const unregistered = [...emitted].filter((name) => !(name in ANALYTICS_EVENTS));
    expect(unregistered, `unregistered emitters: ${unregistered.join(", ")}`).toEqual([]);

    const actual = Object.keys(ANALYTICS_EVENTS)
      .filter((name) => !emitted.has(name))
      .sort();
    expect(planNoEmitterNames().sort()).toEqual(actual);
  });

  it("is exactly 18 names, and none of the six loop moments is on it", () => {
    expect(planNoEmitterNames()).toHaveLength(18);
    for (const event of LOOP_MOMENT_EVENTS) {
      expect(planNoEmitterNames()).not.toContain(event);
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
