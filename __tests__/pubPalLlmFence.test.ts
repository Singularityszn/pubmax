import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import probabilities from "@/__tests__/fixtures/typesafe/pubPalFenceProbabilities.json";
import {
  isPubPalGetHomeOrSobrietyIntent,
  isPubPalSobrietyOnlyIntent,
  pubPalFenceFromNouls,
  pubPalGetHomeRegisterAnswer,
  PUB_PAL_FENCE_NOUL_THRESHOLD,
  type PubPalFenceTurn,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import { PUB_PAL_FENCE_QUESTION_IDS } from "@/lib/pubPalLlmFenceQuestions";

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOne: vi.fn(),
}));

import { systemOne } from "@/lib/ai/typesafe.server";

// A JSON import widens `role` to string, so name the recorded shape once here
// rather than casting at each use. If a fixture ever carries a role the fence
// does not know, this is where it stops.
type RecordedCase = {
  id: string;
  message: string;
  recentTurns: PubPalFenceTurn[];
  expectFenced: boolean;
  expectSobrietyOnly: boolean;
  fitToTravelAfterDrinking: number;
  getHomeTonight: number;
};

const recordedCases = probabilities.cases as RecordedCase[];

function mockSystemOneFromFixture(
  fitToTravelAfterDrinking: number,
  getHomeTonight: number,
): void {
  vi.mocked(systemOne).mockResolvedValue({
    model: "jev-test",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      [PUB_PAL_FENCE_QUESTION_IDS.fitToTravelAfterDrinking]: {
        type: "noul",
        noul: fitToTravelAfterDrinking,
      },
      [PUB_PAL_FENCE_QUESTION_IDS.getHomeTonight]: {
        type: "noul",
        noul: getHomeTonight,
      },
    },
  });
}

describe("Pub Pal regex fence (keyless fallback)", () => {
  it("detects get-home and sobriety intents the table was written for", () => {
    expect(isPubPalGetHomeOrSobrietyIntent("Should I have one more?")).toBe(true);
    expect(isPubPalGetHomeOrSobrietyIntent("When is the last train home?")).toBe(true);
    expect(isPubPalGetHomeOrSobrietyIntent("Quiet garden near Soho")).toBe(false);
  });

  it("splits sobriety-only from combined get-home", () => {
    expect(isPubPalSobrietyOnlyIntent("Should I have one more?")).toBe(true);
    expect(isPubPalSobrietyOnlyIntent("When is the last train home?")).toBe(false);
  });

  it("does not treat paraphrases the regex misses as fenced without TypeSafe", () => {
    expect(isPubPalGetHomeOrSobrietyIntent("Can I drive?")).toBe(false);
    expect(isPubPalGetHomeOrSobrietyIntent("have I had too many?")).toBe(false);
    expect(isPubPalGetHomeOrSobrietyIntent("safe to cycle back?")).toBe(false);
  });
});

describe("Pub Pal TypeSafe fence on recorded fixtures", () => {
  afterEach(() => {
    vi.mocked(systemOne).mockReset();
    delete process.env.TYPESAFE_API_KEY;
  });

  it("uses the threshold chosen from pubPalFenceProbabilities.json", () => {
    expect(PUB_PAL_FENCE_NOUL_THRESHOLD).toBe(0.33);
  });

  it("matches fixture labels when systemOne returns recorded probabilities", async () => {
    for (const caseRow of recordedCases) {
      mockSystemOneFromFixture(
        caseRow.fitToTravelAfterDrinking,
        caseRow.getHomeTonight,
      );
      const intent = await resolvePubPalFenceIntent(caseRow.message, caseRow.recentTurns);
      expect(intent.fenced, caseRow.id).toBe(caseRow.expectFenced);
      if (caseRow.expectFenced) {
        expect(intent.sobrietyOnly, `${caseRow.id} sobriety`).toBe(
          caseRow.expectSobrietyOnly,
        );
      }
    }
  });

  it("fences regex misses when TypeSafe clears the bar", async () => {
    mockSystemOneFromFixture(0.9, 0.05);
    const intent = await resolvePubPalFenceIntent("Can I drive?");
    expect(intent).toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("keeps an explicit alcohol fitness ask fenced after a negative provider classification", async () => {
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent("Can I drive after two beers?"))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });
});

describe("Pub Pal fence without TypeSafe key", () => {
  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    vi.mocked(systemOne).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.mocked(systemOne).mockReset();
  });

  it.each([
    "How many pints can I have before driving?",
    "How many pints can I have in Soho before driving?",
    "Can I drink two pints in Soho before I drive?",
    "How many pints can I have in Soho before driving back?",
    "Before I drive, can I have two pints in Soho?",
    "Would it be safe to drive after two beers?",
    "Am I safe to drive after a pint?",
    "How long after drinking can I drive?",
    "Can I cycle after two pints?",
    "Is one beer okay before riding my bike?",
    "Can I have two beers and still drive?",
  ])("refuses an explicit alcohol allowance or after-alcohol fitness judgment: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: true, sobrietyOnly: true });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it.each([
    "How many pints can I have in Soho before driving home?",
    "How many pints can I have in Soho before I drive home?",
    "When is the last train home?",
  ])("retains the existing practical get-home handoff: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: true, sobrietyOnly: false });
  });

  it.each([
    "Can I drive?",
    "Is it safe to drive?",
    "Can I drive to a beer garden?",
    "Can I cycle to a pub serving beer in Soho?",
    "Before drinking beer, can I drive past Soho?",
    "I have had two beers in Soho. Can I drive?",
    "I'm drunk in Soho. Can I drive?",
    "I like beer. I have had two pints. Can I drive?",
    "I have been drinking alcohol-free beer. Can I drive?",
    "I have been drinking only alcohol-free beer. Can I drive?",
    "I have been drinking alcohol-free beer and two pints. Can I drive?",
    "I have had dinner and two beers. Can I drive?",
    "I have had a couple of beers. Can I drive?",
    "I drank a bottle of wine. Can I drive?",
    "I drank two cold beers. Can I drive?",
    "I have had 1.5 pints. Can I drive?",
    "I drank red wine. Can I drive?",
    "I have had at least two pints. Can I drive?",
    "I have had dinner at the pub and two beers. Can I drive?",
    "I drank water and then drank two beers. Can I drive?",
    "I drank water and dark beer. Can I drive?",
    "I drank water and two beers you recommended. Can I drive?",
    "I drank water and no less than two beers. Can I drive?",
    "I drank water at dinner and then bought wine in Soho. Can I drive?",
    "I drank water at dinner and my friend drank wine in Soho. Can I drive?",
    "I drank water and avoided alcohol. Can I drive?",
    "I drank water and discussed wine. Can I drive?",
    "I drank water in a wine bar. Can I drive?",
    "I have had trouble finding pubs and beer gardens. Can I drive there?",
    "I have had trouble finding pubs and wine bars. Can I drive there?",
  ])("hands a personal driving question to transport without inferring consumption: %s", async (query) => {
    const neutral = { fenced: true, sobrietyOnly: false };
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual(neutral);
    mockSystemOneFromFixture(0.01, 0.01);
    const intent = await resolvePubPalFenceIntent(query);
    expect(intent).toEqual(neutral);
    const answer = pubPalGetHomeRegisterAnswer("", intent.sobrietyOnly);
    expect(answer).toContain("Getting Home");
    expect(answer).not.toContain("another drink");
  });

  it.each([
    [{ role: "user", content: "I have had two beers in Soho." }],
    [{ role: "user", content: "I like beer." }],
    [{ role: "user", content: "I have had two alcohol-free beers." }],
    [{ role: "assistant", content: "I have had two beers in Soho." }],
    [{ role: "user", content: "I drank water and my friend drank wine." }],
  ] satisfies PubPalFenceTurn[][])("keeps the neutral current-question response independent of consumption in history: %j", async (turn) => {
    for (const query of ["Can I drive?", "Can I drive to a beer garden?", "Is it safe to drive?"]) {
      await expect(resolvePubPalFenceIntent(query, [turn]))
        .resolves.toEqual({ fenced: true, sobrietyOnly: false });
    }
  });

  it.each([
    "Quiet garden near Soho",
    "Where can I buy alcohol-free beer in Soho before driving?",
    "Where can I drink alcohol-free beer in Soho before driving?",
    "Where could I drink alcohol-free beer in Soho before driving?",
    "Can I find a pub to drink alcohol-free beer in Soho before driving?",
    "Can I drink alcohol-free beer in Soho before driving?",
    "Can I drink only alcohol-free beer in Soho before driving?",
    "How long after driving before I can buy beer in Soho?",
    "Where can I buy nonalcoholic beer in Soho before driving?",
    "Find a safe cycling route to beer gardens in Soho",
    "I am the designated driver. Find alcohol-free pubs in Soho.",
    "What are the parking options near pubs in Soho?",
    "Where can I buy alcohol-free beer in Soho?",
    "Find four quiet pubs in Soho under £7 per pint.",
    "What time does the bus leave Soho?",
    "Can I have a pint in Soho after driving there?",
    "Where can I buy 0.0% beer in Soho before driving?",
    "Where can I buy non-alcoholic beer in Soho before driving?",
  ])("preserves clear discovery and factual transport: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("does not carry an ambiguous driving question into a later discovery ask", async () => {
    await expect(resolvePubPalFenceIntent("Quiet garden near Soho", [{ role: "user", content: "Can I drive?" }]))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("retains a user's explicit get-home topic but excludes an assistant's", async () => {
    await expect(resolvePubPalFenceIntent("What about Soho?", [{ role: "user", content: "When is the last train home?" }]))
      .resolves.toEqual({ fenced: true, sobrietyOnly: false });
    await expect(resolvePubPalFenceIntent("Quiet garden near Soho", [{ role: "assistant", content: "When is the last train home?" }]))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });
});

describe("pubPalFenceFromNouls", () => {
  it("fires on either Noul clearing the threshold", () => {
    expect(pubPalFenceFromNouls(PUB_PAL_FENCE_NOUL_THRESHOLD, 0)).toEqual({
      fenced: true,
      sobrietyOnly: true,
    });
    expect(pubPalFenceFromNouls(0, PUB_PAL_FENCE_NOUL_THRESHOLD)).toEqual({
      fenced: true,
      sobrietyOnly: false,
    });
  });

  it("stays quiet just under the bar, so an inverted comparison fails here", () => {
    const under = PUB_PAL_FENCE_NOUL_THRESHOLD - 0.01;
    expect(pubPalFenceFromNouls(under, under)).toEqual({
      fenced: false,
      sobrietyOnly: false,
    });
    expect(pubPalFenceFromNouls(0, 0)).toEqual({ fenced: false, sobrietyOnly: false });
  });
});

describe("pubPalGetHomeRegisterAnswer", () => {
  it("keeps the grounded fact and hands off to Getting Home", () => {
    const answer = pubPalGetHomeRegisterAnswer("Last train from Waterloo is 00:32.", false);
    expect(answer).toContain("Last train from Waterloo is 00:32.");
    expect(answer).toContain("Getting Home");
  });
});
