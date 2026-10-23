import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VENUE_RESOLUTION_CASES,
  VENUE_RESOLUTION_POOL,
} from "@/__tests__/fixtures/typesafe/venueResolutionCases";
import {
  collectVenueNameCandidates,
  INTENDED_VENUE_FLOOR,
  isVenueResolutionProbability,
  matchVenueByNameKeyless,
  NONE_OPTION,
  pickIntendedVenueOption,
  uniqueExactVenueNameMatch,
  VENUE_RESOLUTION_CANDIDATE_LIMIT,
} from "@/lib/ask/venueResolution";

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOne: vi.fn(),
}));

import { systemOne } from "@/lib/ai/typesafe.server";
import { matchVenueByName } from "@/lib/ask/venueResolution.server";

const ROOT = process.cwd();
const FIXTURE_PROBS = join(
  ROOT,
  "__tests__/fixtures/typesafe/venue-resolution-probabilities.json",
);

type RecordedCase = {
  id: string;
  query: string;
  expectedId: string | null;
  choice: string;
  probabilities: Record<string, number>;
};

function mockChoice(choice: string, probabilities: Record<string, number>): void {
  vi.mocked(systemOne).mockResolvedValue({
    model: "jev-test",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      intendedVenue: {
        type: "choice",
        choice,
        confidence: probabilities[choice] ?? 0,
        probabilities,
      },
    },
  });
}

describe("matchVenueByNameKeyless (today's matcher)", () => {
  it("matches exact, then startsWith, then includes, and array order breaks ties", () => {
    expect(matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "The Railway Bell")?.id).toBe(
      "venue-railway-bell",
    );
    expect(matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "The Railway")?.id).toBe(
      "venue-railway-bell",
    );
    expect(matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "Greyhound")?.id).toBe(
      "venue-crown-greyhound",
    );
    expect(matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "Crown")?.id).toBe(
      "venue-crown-pepper",
    );
  });

  it("returns null for a blank query", () => {
    expect(matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "  ")).toBeNull();
    expect(matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "")).toBeNull();
  });
});

describe("collectVenueNameCandidates", () => {
  it("collects token-sharing pubs and stays inside the bound", () => {
    const crowns = collectVenueNameCandidates(VENUE_RESOLUTION_POOL, "Crown");
    expect(crowns.length).toBeGreaterThan(1);
    expect(crowns.length).toBeLessThanOrEqual(VENUE_RESOLUTION_CANDIDATE_LIMIT);
    expect(crowns.every((v) => /crown/i.test(v.name))).toBe(true);
  });

  it("ranks an area-qualified query above a same-name twin", () => {
    const hits = collectVenueNameCandidates(VENUE_RESOLUTION_POOL, "angel islington");
    expect(hits[0]?.id).toBe("venue-angel-islington");
  });

  it("returns nothing when the query has no distinctive token", () => {
    expect(collectVenueNameCandidates(VENUE_RESOLUTION_POOL, "the pub")).toEqual([]);
    expect(collectVenueNameCandidates(VENUE_RESOLUTION_POOL, "Soho")).toEqual([]);
  });
});

describe("pickIntendedVenueOption", () => {
  const probs = { none: 0.1, c0: 0.8, c1: 0.1 };

  it.each([1, INTENDED_VENUE_FLOOR] as const)("accepts %s on the winning candidate", (p) => {
    expect(pickIntendedVenueOption("c0", { none: 0, c0: p, c1: 0 })).toBe("c0");
  });

  it("stays on none just under the bar, so an inverted comparison fails here", () => {
    const under = INTENDED_VENUE_FLOOR - 0.01;
    expect(pickIntendedVenueOption("c0", { none: 0.2, c0: under, c1: 0.1 })).toBeNull();
    expect(pickIntendedVenueOption(NONE_OPTION, { none: 0.9, c0: 0.05 })).toBeNull();
  });

  it.each([
    ["0.95"],
    ["1"],
    [95],
    [1.5],
    [-0.5],
    [true],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [null],
    [undefined],
    [{ noul: 0.95 }],
  ])("refuses the non-probability %p", (value) => {
    expect(isVenueResolutionProbability(value)).toBe(false);
    expect(pickIntendedVenueOption("c0", { c0: value, none: 0.1 })).toBeNull();
  });

  it("refuses the whole answer when any sibling probability is malformed", () => {
    expect(pickIntendedVenueOption("c0", { c0: 0.9, none: "0.1" })).toBeNull();
  });

  it("does not publish on argmax without the floor", () => {
    expect(pickIntendedVenueOption("c0", probs, 0.85)).toBeNull();
    expect(pickIntendedVenueOption("c0", probs, 0.8)).toBe("c0");
  });
});

describe("Ask TypeSafe venue resolution on recorded fixtures", () => {
  afterEach(() => {
    vi.mocked(systemOne).mockReset();
    delete process.env.TYPESAFE_API_KEY;
  });

  it("uses the threshold chosen from venue-resolution-probabilities.json", () => {
    const comment = readFileSync(join(ROOT, "lib/ask/venueResolution.ts"), "utf8");
    expect(comment).toContain("__tests__/fixtures/typesafe/venue-resolution-probabilities.json");
    const doc = JSON.parse(readFileSync(FIXTURE_PROBS, "utf8")) as {
      caseCount: number;
      model: string;
      publishThreshold: number;
      cases: RecordedCase[];
    };
    expect(INTENDED_VENUE_FLOOR).toBe(doc.publishThreshold);
    expect(doc.caseCount).toBeGreaterThanOrEqual(40);
    expect(doc.cases).toHaveLength(doc.caseCount);
    expect(doc.model).not.toBe("unknown");
    for (const row of doc.cases) {
      if (row.choice === "skipped-unique-exact") continue;
      expect(isVenueResolutionProbability(row.probabilities[row.choice]), row.id).toBe(true);
    }
  });

  it("matches fixture labels when systemOne returns recorded probabilities", async () => {
    const doc = JSON.parse(readFileSync(FIXTURE_PROBS, "utf8")) as {
      cases: RecordedCase[];
    };
    for (const caseRow of doc.cases) {
      const uniqueExact = uniqueExactVenueNameMatch(VENUE_RESOLUTION_POOL, caseRow.query);
      if (uniqueExact) continue;
      mockChoice(caseRow.choice, caseRow.probabilities);
      const hit = await matchVenueByName(VENUE_RESOLUTION_POOL, caseRow.query);
      expect(hit?.id ?? null, caseRow.id).toBe(caseRow.expectedId);
    }
  });

  it("prefers none over a wrong pub below the floor", async () => {
    mockChoice("c0", { none: 0.4, c0: INTENDED_VENUE_FLOOR - 0.2, c1: 0.1 });
    const hit = await matchVenueByName(VENUE_RESOLUTION_POOL, "Crown");
    expect(hit).toBeNull();
  });

  it("keeps a judged none for a whole question that names a listed pub", async () => {
    mockChoice(NONE_OPTION, { none: 0.9, c0: 0.1 });
    const hit = await matchVenueByName(
      VENUE_RESOLUTION_POOL,
      "How much is a pint at The Druids Head?",
      { wholeQuestion: true },
    );
    expect(hit).toBeNull();
  });
});

describe("Ask venue resolution without TypeSafe key", () => {
  afterEach(() => {
    vi.mocked(systemOne).mockReset();
    delete process.env.TYPESAFE_API_KEY;
  });

  it("never throws and keeps today's matcher when systemOne returns null", async () => {
    delete process.env.TYPESAFE_API_KEY;
    vi.mocked(systemOne).mockResolvedValue(null);
    await expect(matchVenueByName(VENUE_RESOLUTION_POOL, "Crown")).resolves.toEqual(
      matchVenueByNameKeyless(VENUE_RESOLUTION_POOL, "Crown"),
    );
    await expect(matchVenueByName(VENUE_RESOLUTION_POOL, "quiet garden")).resolves.toBeNull();
    await expect(matchVenueByName(VENUE_RESOLUTION_POOL, "")).resolves.toBeNull();
  });

  it("finds a pub named inside a whole question only when asked to", async () => {
    vi.mocked(systemOne).mockResolvedValue(null);
    const question = "How much is a pint at The Druids Head?";
    await expect(
      matchVenueByName(VENUE_RESOLUTION_POOL, question, { wholeQuestion: true }),
    ).resolves.toMatchObject({ id: "venue-druids-head" });
    await expect(matchVenueByName(VENUE_RESOLUTION_POOL, question)).resolves.toBeNull();
  });
});

describe("venue resolution fixture catalog", () => {
  it("ships at least forty real venue names and ambiguous queries", () => {
    expect(VENUE_RESOLUTION_POOL.length).toBeGreaterThanOrEqual(40);
    expect(VENUE_RESOLUTION_CASES.length).toBeGreaterThanOrEqual(40);
    const names = new Set(VENUE_RESOLUTION_POOL.map((v) => v.name));
    expect(names.size).toBeGreaterThanOrEqual(30);
    expect(VENUE_RESOLUTION_CASES.some((c) => c.query === "Crown")).toBe(true);
    expect(VENUE_RESOLUTION_CASES.some((c) => c.query === "Bell")).toBe(true);
    expect(VENUE_RESOLUTION_CASES.some((c) => c.query === "Kings Head")).toBe(true);
    expect(VENUE_RESOLUTION_CASES.some((c) => c.query === "Red Lion")).toBe(true);
    expect(VENUE_RESOLUTION_CASES.some((c) => c.kind === "typo")).toBe(true);
    expect(VENUE_RESOLUTION_CASES.some((c) => c.kind === "partial")).toBe(true);
  });
});
