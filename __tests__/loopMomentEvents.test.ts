import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  LATE_FOOD_CONFIDENCES,
  LATE_FOOD_RESULT_BANDS,
  LOOP_MOMENT_EVENTS,
  RECAP_VISIBILITIES,
  WEEKLY_MEANINGFUL_CORE_ACTIONS,
  sanitizeEvent,
} from "@/lib/analyticsEvents";
import {
  BRIEFING_ARRIVAL_PARAM,
  BRIEFING_ARRIVAL_VALUE,
  BRIEFING_PUSH_URL,
  arrivedFromBriefingPush,
} from "@/lib/briefingArrival";

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const relative = join(dir, entry);
      if (statSync(join(ROOT, relative)).isDirectory()) walk(relative);
      else if (/\.(ts|tsx)$/.test(entry)) found.push(relative);
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(dir);
  return found;
}

/** Every source file that names `trackEvent("<event>"` for one of the six. */
function emittersOf(event: string): string[] {
  const pattern = new RegExp(`trackEvent\\(\\s*"${event}"`);
  return sourceFiles().filter((file) => pattern.test(read(file)));
}

/** Every source file that hands the shared hook one of the six by name. */
function hookCallersOf(event: string): string[] {
  const pattern = new RegExp(`useLoopMoment\\(\\s*\\n?\\s*"${event}"`);
  return sourceFiles().filter((file) => pattern.test(read(file)));
}

describe("the four loop moments are registered", () => {
  it("carries all six names #252 asked for and nothing more per moment", () => {
    expect(ANALYTICS_EVENTS.late_food_viewed).toEqual(["resultBand"]);
    expect(ANALYTICS_EVENTS.late_food_added).toEqual(["confidence"]);
    expect(ANALYTICS_EVENTS.briefing_viewed).toEqual(["personalized", "muted"]);
    expect(ANALYTICS_EVENTS.briefing_opened).toEqual([]);
    expect(ANALYTICS_EVENTS.voice_started).toEqual([]);
    expect(ANALYTICS_EVENTS.recap_viewed).toEqual(["visibility"]);
  });

  it("bands the food shortlist only as far as the served cap allows", () => {
    // MAX_LATE_FOOD_HANDOFFS caps a served shortlist at three, so a third band
    // would register a value nothing can ever send.
    expect(LATE_FOOD_RESULT_BANDS).toEqual(["0", "1-3"]);
    const lateFood = read("lib/lateFood.ts");
    expect(lateFood).toContain("MAX_LATE_FOOD_HANDOFFS = 3");
  });

  it("mirrors the late-food confidence vocabulary exactly", () => {
    expect([...LATE_FOOD_CONFIDENCES]).toEqual(["high", "medium", "low"]);
    expect(read("lib/lateFood.ts")).toContain(
      'export type LateFoodConfidence = "high" | "medium" | "low";',
    );
  });

  it("names only the two published recap visibilities", () => {
    expect(RECAP_VISIBILITIES).toEqual(["public", "unlisted"]);
  });
});

describe("what the sanitizer lets out of the device", () => {
  it("keeps the food band and drops everything that names a place", () => {
    for (const resultBand of LATE_FOOD_RESULT_BANDS) {
      expect(
        sanitizeEvent("late_food_viewed", {
          resultBand,
          venueId: "venue-1",
          terminalId: "kebab-1",
          area: "clapham-high-street",
          latitude: 51.46,
          longitude: -0.13,
        }),
      ).toEqual({ name: "late_food_viewed", props: { resultBand } });
    }
  });

  it("keeps the chosen ending's confidence and drops the terminal itself", () => {
    for (const confidence of LATE_FOOD_CONFIDENCES) {
      expect(
        sanitizeEvent("late_food_added", {
          confidence,
          optionId: "kebab-1",
          name: "The Late Grill",
          sourceUrl: "https://example.test/menu",
          handle: "night_owl",
        }),
      ).toEqual({ name: "late_food_added", props: { confidence } });
    }
  });

  it("keeps the brief's two booleans and never which area or topic is muted", () => {
    expect(
      sanitizeEvent("briefing_viewed", {
        personalized: true,
        muted: true,
        mutedAreas: "clapham",
        mutedTopics: "quiz",
        handle: "night_owl",
      }),
    ).toEqual({ name: "briefing_viewed", props: { personalized: true, muted: true } });
  });

  it("keeps the two propless moments as bare names", () => {
    expect(sanitizeEvent("briefing_opened", { source: "push", handle: "x" }))
      .toEqual({ name: "briefing_opened", props: {} });
    expect(sanitizeEvent("voice_started", { seconds: 42, palId: "pal-1" }))
      .toEqual({ name: "voice_started", props: {} });
  });

  it("keeps a recap's visibility and drops the story it was about", () => {
    for (const visibility of RECAP_VISIBILITIES) {
      expect(
        sanitizeEvent("recap_viewed", {
          visibility,
          storyId: "3f8f2a1e-0000-4000-8000-000000000000",
          title: "A big one in Clapham",
          venueId: "venue-1",
        }),
      ).toEqual({ name: "recap_viewed", props: { visibility } });
    }
  });

  it("fails closed on a missing or invented value", () => {
    expect(sanitizeEvent("late_food_viewed", {})).toBeNull();
    // "4+" is a Near band; a food shortlist can never reach it.
    expect(sanitizeEvent("late_food_viewed", { resultBand: "4+" })).toBeNull();
    expect(sanitizeEvent("late_food_added", {})).toBeNull();
    // A saved snapshot may say "unknown"; that is not a late-food read.
    expect(sanitizeEvent("late_food_added", { confidence: "unknown" })).toBeNull();
    expect(sanitizeEvent("briefing_viewed", { personalized: true })).toBeNull();
    expect(sanitizeEvent("briefing_viewed", { personalized: "yes", muted: false })).toBeNull();
    expect(sanitizeEvent("recap_viewed", {})).toBeNull();
    // A private recap is `memory_reviewed`, and may not arrive under this name.
    expect(sanitizeEvent("recap_viewed", { visibility: "private" })).toBeNull();
  });
});

describe("what the roll-up may count", () => {
  it("names the six moments once, in the registry", () => {
    expect([...LOOP_MOMENT_EVENTS]).toEqual([
      "late_food_viewed",
      "late_food_added",
      "briefing_viewed",
      "briefing_opened",
      "voice_started",
      "recap_viewed",
    ]);
  });

  it("keeps every loop moment out of Weekly Meaningful core actions", () => {
    // Five of the six are impressions, and the roll-up counts value TAKEN. The
    // sixth is an action whose night is already in the roll-up as
    // `plan_completed`, so folding it in would count one night twice.
    for (const event of LOOP_MOMENT_EVENTS) {
      expect(
        (WEEKLY_MEANINGFUL_CORE_ACTIONS as readonly string[]).includes(event),
        `${event} may not be a Weekly Meaningful core action`,
      ).toBe(false);
    }
  });

  it("refuses a loop moment sent as a roll-up action", () => {
    for (const event of LOOP_MOMENT_EVENTS) {
      expect(sanitizeEvent("meaningful_core_action", { action: event })).toBeNull();
    }
  });

  it("counts the food ending's night through plan_completed, in the same save", () => {
    const card = read("components/night/NightModeCard.tsx");
    const added = card.indexOf('trackEvent("late_food_added"');
    const rolledUp = card.indexOf('trackMeaningfulCoreAction(\n            "plan_completed"');
    expect(added).toBeGreaterThan(-1);
    // The ending save is the completion, so the roll-up for that night rides
    // the receipt-gated `plan_completed` a few lines further down the SAME
    // handler. A second roll-up call beside the food ending is what this
    // guards against.
    expect(rolledUp).toBeGreaterThan(added);
    expect(card).not.toMatch(/trackMeaningfulCoreAction\(\s*\n?\s*"late_food_added"/);
  });
});

describe("the briefing arrival marker", () => {
  it("is one fixed key and one fixed value, carried by the push URL", () => {
    expect(BRIEFING_PUSH_URL).toBe(`/today?${BRIEFING_ARRIVAL_PARAM}=${BRIEFING_ARRIVAL_VALUE}`);
    expect(arrivedFromBriefingPush(`?${BRIEFING_ARRIVAL_PARAM}=${BRIEFING_ARRIVAL_VALUE}`)).toBe(true);
    expect(arrivedFromBriefingPush("?from=brief&occasion=quiz")).toBe(true);
  });

  it("reads any other arrival as an ordinary one", () => {
    expect(arrivedFromBriefingPush("")).toBe(false);
    expect(arrivedFromBriefingPush(null)).toBe(false);
    expect(arrivedFromBriefingPush("?from=poster")).toBe(false);
    expect(arrivedFromBriefingPush("?occasion=quiz")).toBe(false);
  });

  it("is what the sender writes, so the two halves cannot drift", () => {
    const sender = read("lib/pushSender.ts");
    expect(sender).toContain('from "@/lib/briefingArrival"');
    expect(sender).toContain('data: { kind: "daily_brief", url: BRIEFING_PUSH_URL }');
    // The literal path would leave the reader with nothing to recognise.
    expect(sender).not.toContain('kind: "daily_brief", url: "/today"');
  });
});

describe("where each moment is emitted, and nowhere else", () => {
  it("reports the food shortlist and the ending it earned from the night card", () => {
    const card = read("components/night/NightModeCard.tsx");
    expect(card).toMatch(/useLoopMoment\("late_food_viewed"/);
    expect(card).toMatch(/trackEvent\("late_food_added", \{ confidence \}\)/);
    expect(hookCallersOf("late_food_viewed")).toEqual(["components/night/NightModeCard.tsx"]);
    expect(emittersOf("late_food_added")).toEqual(["components/night/NightModeCard.tsx"]);
  });

  it("reports the food ending only after the save came back canonical", () => {
    const card = read("components/night/NightModeCard.tsx");
    const saved = card.indexOf("setPlan(canonical);");
    const added = card.indexOf('trackEvent("late_food_added"');
    expect(saved).toBeGreaterThan(-1);
    // A refused save leaves the night where it was, so the tap is not the event.
    expect(added).toBeGreaterThan(saved);
  });

  it("reports both briefing moments from the one morning-brief surface", () => {
    const today = read("app/today/TodayClient.tsx");
    expect(today).toMatch(/useLoopMoment\(\s*\n?\s*"briefing_viewed"/);
    expect(today).toMatch(/useLoopMoment\("briefing_opened"/);
    expect(hookCallersOf("briefing_viewed")).toEqual(["app/today/TodayClient.tsx"]);
    expect(hookCallersOf("briefing_opened")).toEqual(["app/today/TodayClient.tsx"]);
  });

  it("reports a voice session on connect, never on the tap", () => {
    const session = read("components/pubpal/PubPalVoiceSession.tsx");
    expect(emittersOf("voice_started")).toEqual(["components/pubpal/PubPalVoiceSession.tsx"]);
    const connect = session.indexOf("onConnect:");
    const emitted = session.indexOf('trackEvent("voice_started")');
    const failure = session.indexOf("onFailure: (message) => {");
    expect(connect).toBeGreaterThan(-1);
    expect(emitted).toBeGreaterThan(connect);
    expect(emitted).toBeLessThan(failure);
    // One report per attempt: connectedAt is null until the first connect.
    expect(session).toContain('if (attempt.connectedAt === null) trackEvent("voice_started");');
  });

  it("reports a recap read from the PUBLISHED page, and never from the private one", () => {
    expect(hookCallersOf("recap_viewed")).toEqual(["components/plan/RecapViewAnalytics.tsx"]);
    expect(read("app/recap/[storyId]/page.tsx")).toContain(
      "<RecapViewAnalytics visibility={recapVisibility} />",
    );
    // /plan/[id]/recap already reports memory_reviewed; two names for one read
    // would double every recap figure on the dashboard.
    const privateRecap = read("app/plan/[id]/recap/page.tsx");
    expect(privateRecap).toContain("<MemoryReviewAnalytics />");
    expect(privateRecap).not.toContain("RecapViewAnalytics");
    expect(read("components/plan/MemoryReviewAnalytics.tsx")).not.toContain("recap_viewed");
  });

  it("has no server half: every one of the six is a browser impression", () => {
    for (const event of LOOP_MOMENT_EVENTS) {
      const server = [...emittersOf(event), ...hookCallersOf(event)]
        .filter((file) => file.includes(".server.") || file.startsWith(join("app", "api")));
      expect(server, `${event} is emitted server-side by ${server.join(", ")}`).toEqual([]);
    }
  });

  it("keeps all six off the tracking plan's no-emitter list", () => {
    const plan = read("docs/analytics/TRACKING_PLAN.md");
    const noEmitter = plan.slice(plan.indexOf("## 6. Registered with no emitter today"));
    for (const event of LOOP_MOMENT_EVENTS) {
      expect(noEmitter).not.toContain(`\`${event}\``);
      // Every one is still named somewhere in the plan (section 5.2.1).
      expect(plan).toContain(`\`${event}\``);
    }
  });
});
