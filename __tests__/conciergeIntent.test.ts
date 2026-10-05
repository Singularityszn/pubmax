import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseConciergeIntent } from "@/lib/concierge/intent";
import {
  AREA_NONE,
  BUDGET_CHEAP,
  BUDGET_EXPLICIT,
  BUDGET_UNSTATED,
  CHEAP_PINT_GBP,
  CONCIERGE_CHOICE_FLOOR,
  CONCIERGE_MOOD_NOUL_THRESHOLD,
  DEFAULT_GROUP_SIZE,
  GROUP_UNSTATED,
  areaCandidatesInText,
  areaVerbatimInText,
  defaultKnownAreas,
  groupSizeCandidatesInText,
  intentFromJudgment,
  isConciergeProbability,
  moodsFromNouls,
  validateJudgedIntent,
} from "@/lib/concierge/intentPolicy";
import { CONCIERGE_MOODS, type ConciergeMood } from "@/lib/concierge/rank";

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOne: vi.fn(),
}));

import { systemOne } from "@/lib/ai/typesafe.server";

const ROOT = process.cwd();

function missNouls(): Partial<Record<ConciergeMood, number>> {
  return Object.fromEntries(CONCIERGE_MOODS.map((mood) => [mood, 0.05]));
}

function hitNouls(hits: ConciergeMood[], value = 0.9): Partial<Record<ConciergeMood, number>> {
  return { ...missNouls(), ...Object.fromEntries(hits.map((mood) => [mood, value])) };
}

function mockSystemOne(input: {
  moods?: Partial<Record<ConciergeMood, number>>;
  area?: string;
  areaProb?: number;
  group?: string;
  groupProb?: number;
  budget?: string;
  budgetProb?: number;
}): void {
  const moods = input.moods ?? missNouls();
  const area = input.area ?? AREA_NONE;
  const group = input.group ?? GROUP_UNSTATED;
  const budget = input.budget ?? BUDGET_UNSTATED;
  const areaProb = input.areaProb ?? 0.9;
  const groupProb = input.groupProb ?? 0.9;
  const budgetProb = input.budgetProb ?? 0.9;
  vi.mocked(systemOne).mockResolvedValue({
    model: "jev-test",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      ...Object.fromEntries(
        CONCIERGE_MOODS.map((mood) => [
          `mood_${mood}`,
          { type: "noul", noul: moods[mood] ?? 0.05 },
        ]),
      ),
      area: {
        type: "choice",
        choice: area,
        confidence: areaProb,
        probabilities: { [area]: areaProb, [AREA_NONE]: area === AREA_NONE ? areaProb : 1 - areaProb },
      },
      groupSize: {
        type: "choice",
        choice: group,
        confidence: groupProb,
        probabilities: { [group]: groupProb, [GROUP_UNSTATED]: group === GROUP_UNSTATED ? groupProb : 1 - groupProb },
      },
      budgetSignal: {
        type: "choice",
        choice: budget,
        confidence: budgetProb,
        probabilities: {
          [BUDGET_EXPLICIT]: budget === BUDGET_EXPLICIT ? budgetProb : 0.05,
          [BUDGET_CHEAP]: budget === BUDGET_CHEAP ? budgetProb : 0.05,
          [BUDGET_UNSTATED]: budget === BUDGET_UNSTATED ? budgetProb : 0.05,
        },
      },
    },
  });
}

describe("parseConciergeIntent keyless fallback", () => {
  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.PUBMAX_E2E_KEYLESS;
    vi.mocked(systemOne).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.mocked(systemOne).mockReset();
  });

  it("turns ordinary coordination language into a structured intent without a key", async () => {
    const parsed = await parseConciergeIntent("Quiet-ish near Bank, 4 of us, not pricey");

    expect(parsed).toEqual({
      intent: { mood: ["quiet"], groupSize: 4, area: "Bank", maxPintPrice: 6 },
      source: "deterministic",
    });
  });

  it("does not mistake a pint-price budget for the crew size", async () => {
    const parsed = await parseConciergeIntent("Quiet near Bank under £7");

    expect(parsed.intent).toEqual({
      mood: ["quiet"],
      groupSize: 2,
      area: "Bank",
      maxPintPrice: 7,
    });
  });

  it("never throws when systemOne returns null", async () => {
    await expect(parseConciergeIntent("Sports near Waterloo for 8")).resolves.toEqual({
      intent: { mood: ["sports"], groupSize: 8, area: "Waterloo" },
      source: "deterministic",
    });
  });

  it("stops the area at a time word, so a crawl tonight still has an area", async () => {
    const parsed = await parseConciergeIntent("Plan me a 3 pub crawl in Shoreditch tonight");

    expect(parsed.intent.area).toBe("Shoreditch");
  });

  it("reads a known area after at, or a request that is only the area", async () => {
    await expect(parseConciergeIntent("Can you plan a crawl at Shoreditch?")).resolves.toMatchObject({
      intent: { area: "Shoreditch" },
    });
    await expect(parseConciergeIntent("shoreditch")).resolves.toMatchObject({
      intent: { area: "Shoreditch" },
    });
  });

  it.each([
    "Can you plan a Shoreditch crawl?",
    "plan me a shoreditch pub crawl tonight",
    "Best Shoreditch pubs for 4",
    "Plan a Shoreditch pub-crawl",
    "Start at the Angel pub, then a crawl in Shoreditch",
  ])("reads a known area named just before a night out in %j", async (text) => {
    const parsed = await parseConciergeIntent(text);

    expect(parsed.intent.area).toBe("Shoreditch");
  });

  it.each([
    "Plan a crawl for Victoria's birthday",
    "a crawl along the Victoria line",
  ])("does not read an area named without a preposition in %j", async (text) => {
    const parsed = await parseConciergeIntent(text);

    expect(parsed.intent.area).toBeUndefined();
  });

  it.each([
    ["Plan a crawl in Victoria Park", "Victoria Park"],
    ["pubs in Camden Passage", "Camden Passage"],
  ])("keeps a longer place name that starts with a known area in %j", async (text, area) => {
    const parsed = await parseConciergeIntent(text);

    expect(parsed.intent.area).toBe(area);
  });

  it.each([
    ["crawl in victoria park tonight", "Victoria"],
    ["Plan a crawl in Victoria Park tonight", "Victoria"],
    ["pubs in camden passage", "Camden"],
    ["pubs in Camden Passage", "Camden"],
  ])("does not read %j as the known area it starts with", async (text, knownArea) => {
    const parsed = await parseConciergeIntent(text);

    expect(parsed.intent.area).not.toBe(knownArea);
  });

  it.each([
    ["Plan a pub crawl in Shoreditch London tonight", "Shoreditch"],
    ["Plan a crawl in Soho I want cheap pints", "Soho"],
  ])("reads a known area followed by a capitalised word in %j", async (text, area) => {
    const parsed = await parseConciergeIntent(text);

    expect(parsed.intent.area).toBe(area);
  });

  it("reads the first known area named, not the longest", async () => {
    const parsed = await parseConciergeIntent("Crawl in Camden, finishing near King's Cross");

    expect(parsed.intent.area).toBe("Camden");
  });

  it("falls back to regex when systemOne throws and never spends without a key", async () => {
    vi.mocked(systemOne).mockRejectedValue(new Error("typesafe unavailable"));
    await expect(parseConciergeIntent("Cheapest pint in Camden tonight")).resolves.toEqual({
      intent: expect.objectContaining({ mood: [], groupSize: 2 }),
      source: "deterministic",
    });
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("stays on the regex path when skipModel is set even if a key exists", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    mockSystemOne({
      moods: hitNouls(["garden"]),
      area: "Soho",
      group: "6",
      budget: BUDGET_EXPLICIT,
    });
    const parsed = await parseConciergeIntent("Garden in Soho for 6 under £7", { skipModel: true });
    expect(parsed.source).toBe("deterministic");
    expect(systemOne).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("never spends on intent when PUBMAX_E2E_KEYLESS is set, even with a key", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubEnv("PUBMAX_E2E_KEYLESS", "1");
    mockSystemOne({
      moods: hitNouls(["garden"]),
      area: "Camden",
    });
    const parsed = await parseConciergeIntent("anything in Camden with a garden");
    expect(parsed.source).toBe("deterministic");
    expect(parsed.intent.mood).toContain("garden");
    expect(systemOne).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("parses the Pub Pal recall thread on the regex path without calling TypeSafe", async () => {
    const prior = ["Quiet pub in Camden for four", "cheaper"];
    const current = "anything in Camden with a garden";
    for (const line of [...prior, current]) {
      const parsed = await parseConciergeIntent(line, { skipModel: true });
      expect(parsed.source).toBe("deterministic");
    }
    const { palRecall } = await import("@/lib/palRecall");
    expect(palRecall(prior, current)?.line).toBe("You asked about Camden earlier.");
    expect(systemOne).not.toHaveBeenCalled();
  });
});

describe("parseConciergeIntent TypeSafe path", () => {
  beforeEach(() => {
    delete process.env.PUBMAX_E2E_KEYLESS;
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.mocked(systemOne).mockReset();
    vi.unstubAllEnvs();
  });

  it("accepts typed answers in place of prompt-then-parse JSON", async () => {
    mockSystemOne({
      moods: hitNouls(["garden"]),
      area: "Soho",
      group: "6",
      budget: BUDGET_EXPLICIT,
    });

    const parsed = await parseConciergeIntent("Garden in Soho for 6 under £7");

    expect(parsed).toEqual({
      intent: { mood: ["garden"], groupSize: 6, area: "Soho", maxPintPrice: 7 },
      source: "model",
    });
  });

  it("falls back honestly when the judgment call fails", async () => {
    vi.mocked(systemOne).mockResolvedValue(null);

    const parsed = await parseConciergeIntent("Sports near Waterloo for 8");

    expect(parsed).toEqual({
      intent: { mood: ["sports"], groupSize: 8, area: "Waterloo" },
      source: "deterministic",
    });
  });

  it("falls back to regex when systemOne throws with a key configured", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOne).mockRejectedValue(new Error("typesafe unavailable"));

    const parsed = await parseConciergeIntent("Somewhere to work with wifi in Angel");

    expect(parsed.source).toBe("deterministic");
    expect(parsed.intent.groupSize).toBe(2);
    vi.unstubAllEnvs();
  });

  it("refuses a hallucinated area that is not verbatim in the request", async () => {
    mockSystemOne({
      moods: hitNouls(["cosy"]),
      area: "Paris",
      areaProb: 0.99,
      group: "2",
    });

    const parsed = await parseConciergeIntent("Cosy in Shoreditch for two");

    expect(parsed).toEqual({
      intent: { mood: ["cosy"], groupSize: 2, area: "Shoreditch" },
      source: "deterministic",
    });
  });

  it("keeps mixed moods that each clear the Noul floor", async () => {
    mockSystemOne({
      moods: hitNouls(["quiet", "garden"]),
      area: "Soho",
      group: GROUP_UNSTATED,
      budget: BUDGET_UNSTATED,
    });

    const parsed = await parseConciergeIntent("Quiet garden near Soho");
    expect(parsed.source).toBe("model");
    expect(parsed.intent.mood).toEqual(["quiet", "garden"]);
    expect(parsed.intent.area).toBe("Soho");
  });
});

describe("intentFromJudgment", () => {
  const known = defaultKnownAreas();

  it("uses the threshold chosen from conciergeIntentProbabilities.json", () => {
    const comment = readFileSync(join(ROOT, "lib/concierge/intentPolicy.ts"), "utf8");
    expect(comment).toContain("__tests__/fixtures/typesafe/conciergeIntentProbabilities.json");
    expect(CONCIERGE_MOOD_NOUL_THRESHOLD).toBe(0.63);
    expect(CONCIERGE_CHOICE_FLOOR).toBe(0.55);
  });

  it("fires a mood at the floor, so an inverted comparison fails here", () => {
    const at = moodsFromNouls(hitNouls(["quiet"], CONCIERGE_MOOD_NOUL_THRESHOLD));
    const under = moodsFromNouls(hitNouls(["quiet"], CONCIERGE_MOOD_NOUL_THRESHOLD - 0.01));
    expect(at).toEqual(["quiet"]);
    expect(under).toEqual([]);
  });

  it("does not publish a Choice on argmax below the floor", () => {
    const intent = intentFromJudgment("Garden in Soho for 6 under £7", {
      moods: hitNouls(["garden"]),
      areaChoice: "Soho",
      areaProbabilities: { Soho: 0.13, [AREA_NONE]: 0.11 },
      groupChoice: "6",
      groupProbabilities: { "6": 0.13, [GROUP_UNSTATED]: 0.11 },
      budgetChoice: BUDGET_EXPLICIT,
      budgetProbabilities: { [BUDGET_EXPLICIT]: 0.13, [BUDGET_CHEAP]: 0.11, [BUDGET_UNSTATED]: 0.1 },
      areaOptions: areaCandidatesInText("Garden in Soho for 6 under £7", known),
      groupOptions: groupSizeCandidatesInText("Garden in Soho for 6 under £7"),
    });
    expect(intent).not.toBeNull();
    expect(intent?.area).toBeUndefined();
    expect(intent?.groupSize).toBe(DEFAULT_GROUP_SIZE);
    expect(intent?.maxPintPrice).toBeUndefined();
  });

  it("refuses a non-probability before any comparison", () => {
    expect(isConciergeProbability("0.95")).toBe(false);
    expect(isConciergeProbability(95)).toBe(false);
    expect(isConciergeProbability(true)).toBe(false);
    expect(isConciergeProbability(Number.NaN)).toBe(false);
    expect(moodsFromNouls(hitNouls(["quiet"], "0.95" as unknown as number))).toBeNull();
    expect(
      intentFromJudgment("Quiet near Soho", {
        moods: hitNouls(["quiet"]),
        areaChoice: "Soho",
        areaProbabilities: { Soho: "0.95" },
        groupChoice: GROUP_UNSTATED,
        budgetChoice: BUDGET_UNSTATED,
        areaOptions: ["Soho"],
        groupOptions: [],
      }),
    ).toBeNull();
  });

  it("keeps cheap as six pounds when the budget Choice is cheap", () => {
    const intent = intentFromJudgment("Quiet-ish near Bank, 4 of us, not pricey", {
      moods: hitNouls(["quiet"]),
      areaChoice: "Bank",
      areaProbabilities: { Bank: 0.9, [AREA_NONE]: 0.05 },
      groupChoice: "4",
      groupProbabilities: { "4": 0.9, [GROUP_UNSTATED]: 0.05 },
      budgetChoice: BUDGET_CHEAP,
      budgetProbabilities: { [BUDGET_CHEAP]: 0.9, [BUDGET_EXPLICIT]: 0.05, [BUDGET_UNSTATED]: 0.05 },
      areaOptions: ["Bank"],
      groupOptions: ["4"],
    });
    expect(intent).toEqual({
      mood: ["quiet"],
      groupSize: 4,
      area: "Bank",
      maxPintPrice: CHEAP_PINT_GBP,
    });
  });
});

describe("candidate finders", () => {
  it("finds known aliases and regex phrases, and skips prices as group sizes", () => {
    const known = defaultKnownAreas();
    expect(areaCandidatesInText("Garden in Soho for 6", known)).toContain("Soho");
    expect(areaCandidatesInText("Quiet-ish near Bank, 4 of us", known)).toContain("Bank");
    expect(groupSizeCandidatesInText("Quiet near Bank under £7")).toEqual([]);
    expect(groupSizeCandidatesInText("Garden in Soho for 6 under £7")).toEqual(["6"]);
    expect(groupSizeCandidatesInText("Cosy in Shoreditch for two")).toEqual(["2"]);
  });
});

describe("validateJudgedIntent verbatim area", () => {
  it("refuses an area that is not a phrase in the request", () => {
    expect(
      validateJudgedIntent(
        { mood: ["cosy"], groupSize: 2, area: "Paris" },
        "Cosy in Shoreditch for two",
      ),
    ).toBeNull();
    expect(areaVerbatimInText("Cosy in Shoreditch for two", "Shoreditch")).toBe(true);
    expect(areaVerbatimInText("Cosy in Shoreditch for two", "Paris")).toBe(false);
  });
});

describe("recorded concierge intent fixtures", () => {
  const labels = JSON.parse(
    readFileSync(join(ROOT, "__tests__/fixtures/typesafe/conciergeIntentCases.json"), "utf8"),
  ) as {
    cases: Array<{
      id: string;
      text: string;
      expectMoods: ConciergeMood[];
      expectArea: string | null;
      expectGroupSize: number;
      expectBudget: "explicit figure" | "cheap" | "unstated";
      expectMaxPintPrice: number | null;
    }>;
  };
  const recorded = JSON.parse(
    readFileSync(join(ROOT, "__tests__/fixtures/typesafe/conciergeIntentProbabilities.json"), "utf8"),
  ) as {
    model: string;
    cases: Array<{
      id: string;
      moods: Record<ConciergeMood, number>;
      areaChoice: string | null;
      areaProbabilities: Record<string, number>;
      groupChoice: string | null;
      groupProbabilities: Record<string, number>;
      budgetChoice: string | null;
      budgetProbabilities: Record<string, number>;
    }>;
  };

  it("records at least forty real-shaped requests and names the model", () => {
    expect(labels.cases.length).toBeGreaterThanOrEqual(40);
    expect(recorded.cases).toHaveLength(labels.cases.length);
    expect(recorded.model).toMatch(/^jev-/);
    for (const row of recorded.cases) {
      for (const mood of CONCIERGE_MOODS) {
        expect(isConciergeProbability(row.moods[mood]), `${row.id} ${mood}`).toBe(true);
      }
    }
  });

  it("matches fixture labels when recorded probabilities are replayed", () => {
    const known = defaultKnownAreas();
    const byId = new Map(recorded.cases.map((row) => [row.id, row]));
    for (const label of labels.cases) {
      const row = byId.get(label.id);
      expect(row, label.id).toBeDefined();
      if (!row) continue;
      const composed = intentFromJudgment(label.text, {
        moods: row.moods,
        areaChoice: row.areaChoice ?? AREA_NONE,
        areaProbabilities: row.areaProbabilities,
        groupChoice: row.groupChoice ?? GROUP_UNSTATED,
        groupProbabilities: row.groupProbabilities,
        budgetChoice: row.budgetChoice,
        budgetProbabilities: row.budgetProbabilities,
        areaOptions: areaCandidatesInText(label.text, known),
        groupOptions: groupSizeCandidatesInText(label.text),
      });
      expect(composed, label.id).not.toBeNull();
      expect(composed?.mood, label.id).toEqual(label.expectMoods);
      expect(composed?.area ?? null, label.id).toBe(label.expectArea);
      expect(composed?.groupSize, label.id).toBe(label.expectGroupSize);
      expect(composed?.maxPintPrice ?? null, label.id).toBe(label.expectMaxPintPrice);
    }
  });

  it("fails if the mood threshold is inverted against the fixture gap", () => {
    const cheapBrixton = recorded.cases.find((row) => row.id === "cheap-brixton-word");
    const quietDinner = recorded.cases.find((row) => row.id === "quiet-food-chiswick");
    expect(cheapBrixton?.moods.balanced).toBeLessThan(CONCIERGE_MOOD_NOUL_THRESHOLD);
    expect(quietDinner?.moods.quiet).toBeGreaterThanOrEqual(CONCIERGE_MOOD_NOUL_THRESHOLD);
  });
});
