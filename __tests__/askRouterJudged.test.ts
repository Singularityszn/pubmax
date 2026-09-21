import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import casesFile from "@/__tests__/fixtures/typesafe/ask-router-cases.json";
import { findAskAreaCandidates, findAskVenueCandidates } from "@/lib/ask/routerCandidates";
import {
  ASK_ROUTER_NONE,
  ASK_ROUTER_TOOL_FLOOR,
  isAskRouterProbability,
  judgedToolClearsFloor,
  parseAskRouterJudgment,
  publishedAskTool,
  type AskRouterJudgment,
} from "@/lib/ask/routerPolicy";
import { routeAskDeterministically } from "@/lib/ask/router";
import { ASK_TOOL_NAMES, isAskToolName } from "@/lib/ask/types";

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOneOutcome: vi.fn(),
}));

import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { routeAsk } from "@/lib/ask/routerJudged";

const ROOT = process.cwd();
const CASES_PATH = join(ROOT, "__tests__/fixtures/typesafe/ask-router-cases.json");
const PROB_PATH = join(ROOT, "__tests__/fixtures/typesafe/ask-router-probabilities.json");
const POLICY_PATH = join(ROOT, "lib/ask/routerPolicy.ts");

type FixtureCase = {
  id: string;
  query: string;
  regexTool: string;
  gold: boolean;
};

type RecordedCase = FixtureCase & {
  tool: string;
  toolProbability: number;
  toolConfidence: number;
  venue: string;
  venueProbability: number;
  venueConfidence: number;
  area: string;
  areaProbability: number;
  areaConfidence: number;
  wantsMap: number;
};

const fixtureCases = casesFile.cases as FixtureCase[];
const fixtureVenues = casesFile.venues;

function judgment(overrides: Partial<AskRouterJudgment> = {}): AskRouterJudgment {
  return {
    tool: "search_venues",
    toolProbability: 0.9,
    toolConfidence: 0.9,
    venue: ASK_ROUTER_NONE,
    venueProbability: 0.9,
    venueConfidence: 0.9,
    area: ASK_ROUTER_NONE,
    areaProbability: 0.9,
    areaConfidence: 0.9,
    wantsMap: 0.05,
    ...overrides,
  };
}

function mockOk(answers: Record<string, unknown>): void {
  vi.mocked(systemOneOutcome).mockResolvedValue({
    status: "ok",
    result: {
      model: "jev-test",
      usage: { input_tokens: 1, output_tokens: 1 },
      answers,
    },
  } as Awaited<ReturnType<typeof systemOneOutcome>>);
}

function choiceAnswer(option: string, probability: number, confidence = probability) {
  return {
    type: "choice",
    choice: option,
    confidence,
    probabilities: { [option]: probability, [ASK_ROUTER_NONE]: Math.max(0, 1 - probability) },
  };
}

describe("Ask router regex fixtures stay gold", () => {
  it("has at least 60 cases covering every regex tool", () => {
    expect(fixtureCases.length).toBeGreaterThanOrEqual(60);
    const tools = new Set(fixtureCases.map((row) => row.regexTool));
    for (const name of ASK_TOOL_NAMES) {
      expect(tools.has(name), name).toBe(true);
    }
  });

  it("every gold case matches the deterministic router", () => {
    for (const row of fixtureCases.filter((item) => item.gold)) {
      const calls = routeAskDeterministically(row.query);
      expect(isAskToolName(row.regexTool), row.id).toBe(true);
      expect(calls.map((call) => call.name), row.id).toContain(row.regexTool);
    }
  });
});

describe("isAskRouterProbability", () => {
  it.each([["0.95"], ["1"], [95], [1.5], [-0.5], [true], [Number.NaN], [Number.POSITIVE_INFINITY], [null], [undefined], [{ noul: 0.95 }]])(
    "refuses the non-probability %p",
    (value) => {
      expect(isAskRouterProbability(value)).toBe(false);
    },
  );

  it("accepts the closed unit interval", () => {
    expect(isAskRouterProbability(0)).toBe(true);
    expect(isAskRouterProbability(1)).toBe(true);
    expect(isAskRouterProbability(0.6)).toBe(true);
  });
});

describe("judgedToolClearsFloor", () => {
  it("stays quiet just under the bar, so an inverted comparison fails here", () => {
    const under = ASK_ROUTER_TOOL_FLOOR - 0.01;
    expect(judgedToolClearsFloor(judgment({ toolProbability: under, toolConfidence: 0.99 }))).toBe(
      false,
    );
    expect(judgedToolClearsFloor(judgment({ toolProbability: 0.99, toolConfidence: under }))).toBe(
      false,
    );
  });

  it("publishes at the floor and refuses none", () => {
    expect(
      judgedToolClearsFloor(
        judgment({
          tool: "venue_prices",
          toolProbability: ASK_ROUTER_TOOL_FLOOR,
          toolConfidence: ASK_ROUTER_TOOL_FLOOR,
        }),
      ),
    ).toBe(true);
    expect(judgedToolClearsFloor(judgment({ tool: ASK_ROUTER_NONE }))).toBe(false);
  });

  it("never publishes on argmax without the floor", () => {
    expect(
      judgedToolClearsFloor(
        judgment({ tool: "city_status", toolProbability: 0.13, toolConfidence: 0.12 }),
      ),
    ).toBe(false);
  });
});

describe("parseAskRouterJudgment", () => {
  it("rejects a string probability before any comparison", () => {
    expect(
      parseAskRouterJudgment({
        tool: {
          type: "choice",
          choice: "venue_prices",
          confidence: 0.9,
          probabilities: { venue_prices: "0.95" },
        },
        venue: choiceAnswer(ASK_ROUTER_NONE, 0.9),
        area: choiceAnswer(ASK_ROUTER_NONE, 0.9),
        wantsMap: { type: "noul", noul: 0.1 },
      }),
    ).toBeNull();
  });
});

describe("routeAsk judged path (SDK mocked)", () => {
  afterEach(() => {
    vi.mocked(systemOneOutcome).mockReset();
    delete process.env.TYPESAFE_API_KEY;
  });

  it("never throws and keeps regex behaviour when the key is missing", async () => {
    vi.mocked(systemOneOutcome).mockResolvedValue({ status: "skipped", reason: "no_key" });
    await expect(routeAsk("Cheapest pint in Camden")).resolves.toEqual({
      calls: routeAskDeterministically("Cheapest pint in Camden"),
      source: "regex",
      dropReason: "no_key",
    });
  });

  it("falls back to regex on timeout with a drop reason, never throwing", async () => {
    vi.mocked(systemOneOutcome).mockResolvedValue({ status: "failed", reason: "timeout" });
    const result = await routeAsk("Quiz tonight in Soho");
    expect(result.source).toBe("regex");
    expect(result.dropReason).toBe("timeout");
    expect(result.calls[0]?.name).toBe("whats_on");
  });

  it("falls back on a malformed answer", async () => {
    mockOk({
      tool: { type: "choice", choice: "whats_on", confidence: "high", probabilities: {} },
    });
    const result = await routeAsk("Quiz tonight in Soho");
    expect(result).toMatchObject({ source: "regex", dropReason: "malformed-answer" });
  });

  it("falls back below the floor instead of publishing argmax", async () => {
    mockOk({
      tool: choiceAnswer("search_venues", 0.13, 0.12),
      venue: choiceAnswer(ASK_ROUTER_NONE, 0.9),
      area: choiceAnswer(ASK_ROUTER_NONE, 0.9),
      wantsMap: { type: "noul", noul: 0.1 },
    });
    const result = await routeAsk("Quiz tonight in Soho");
    expect(result.source).toBe("regex");
    expect(result.dropReason).toBe("below-floor");
    expect(result.calls[0]?.name).toBe("whats_on");
  });

  it("takes the judged tool when it clears the floor", async () => {
    mockOk({
      tool: choiceAnswer("venue_heritage", 0.92, 0.88),
      venue: choiceAnswer("the-lamb", 0.9, 0.85),
      area: choiceAnswer(ASK_ROUTER_NONE, 0.8),
      wantsMap: { type: "noul", noul: 0.04 },
    });
    const result = await routeAsk("Tell me the history of The Lamb", {
      venues: fixtureVenues,
    });
    expect(result.source).toBe("judged");
    expect(result.calls[0]?.name).toBe("venue_heritage");
    expect(result.calls[0]?.args.venueName).toBe("The Lamb");
  });
});

describe("candidate finding", () => {
  it("caps venue candidates and prefers substring hits", () => {
    const found = findAskVenueCandidates("history of The Lamb", {
      venues: fixtureVenues,
      nearbyVenues: [{ id: "the-crown", name: "The Crown", area: "Victoria" }],
    });
    expect(found.length).toBeLessThanOrEqual(12);
    expect(found.some((row) => row.id === "the-lamb")).toBe(true);
  });

  it("always includes a none area option", () => {
    const areas = findAskAreaCandidates("Cheapest pint in Camden");
    expect(areas.some((row) => row.id === ASK_ROUTER_NONE)).toBe(true);
    expect(areas.some((row) => /camden/i.test(row.name))).toBe(true);
  });
});

describe("recorded Ask-router probabilities", () => {
  const doc = JSON.parse(readFileSync(PROB_PATH, "utf8")) as {
    recordedAt: string;
    model: string;
    toolFloor: number;
    cases: RecordedCase[];
  };

  it("cites the fixture file beside the threshold", () => {
    const source = readFileSync(POLICY_PATH, "utf8");
    expect(source).toContain("__tests__/fixtures/typesafe/ask-router-probabilities.json");
    expect(ASK_ROUTER_TOOL_FLOOR).toBe(doc.toolFloor);
  });

  it("records every fixture case with unit-interval probabilities", () => {
    expect(doc.cases.length).toBe(fixtureCases.length);
    expect(doc.model).not.toBe("unknown");
    for (const row of doc.cases) {
      expect(isAskRouterProbability(row.toolProbability), row.id).toBe(true);
      expect(isAskRouterProbability(row.toolConfidence), row.id).toBe(true);
      expect(isAskRouterProbability(row.wantsMap), row.id).toBe(true);
    }
  });

  it("never routes a gold regex case to a different tool below the floor", () => {
    const gold = doc.cases.filter((item) => item.gold);
    const disagreements = gold.filter((row) => row.tool !== row.regexTool);
    for (const row of gold) {
      const parsed = parseAskRouterJudgment({
        tool: choiceAnswer(row.tool, row.toolProbability, row.toolConfidence),
        venue: choiceAnswer(row.venue, row.venueProbability, row.venueConfidence),
        area: choiceAnswer(row.area, row.areaProbability, row.areaConfidence),
        wantsMap: { type: "noul", noul: row.wantsMap },
      });
      expect(parsed, row.id).not.toBeNull();
      const published = publishedAskTool(parsed!, row.regexTool as (typeof ASK_TOOL_NAMES)[number]);
      if (parsed!.tool !== row.regexTool && parsed!.toolConfidence < ASK_ROUTER_TOOL_FLOOR) {
        expect(published, row.id).toBe(row.regexTool);
      }
      if (parsed!.tool !== row.regexTool && parsed!.toolConfidence >= ASK_ROUTER_TOOL_FLOOR) {
        expect(published, row.id).toBe(parsed!.tool);
      }
    }
    // Floor 0.6 sits above the two low-confidence agreements (0.55, 0.59) and
    // below the two high-confidence disagreements the fixture run recorded.
    expect(disagreements.map((row) => row.id).sort()).toEqual([
      "cocktail-price-lamb",
      "drink-prices-camden",
    ]);
    for (const row of disagreements) {
      expect(row.toolConfidence, row.id).toBeGreaterThanOrEqual(ASK_ROUTER_TOOL_FLOOR);
    }
  });
});

describe("ask-router-cases.json is the committed catalog", () => {
  it("matches the inlined import", () => {
    const disk = JSON.parse(readFileSync(CASES_PATH, "utf8")) as typeof casesFile;
    expect(disk.cases).toHaveLength(fixtureCases.length);
  });
});
