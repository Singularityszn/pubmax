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

  it("fences an alcohol allowance before driving without a destination", async () => {
    await expect(resolvePubPalFenceIntent("How many pints can I have in Soho before driving?"))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("keeps an alcohol-free discovery request out of the fitness fence", async () => {
    await expect(resolvePubPalFenceIntent("Where can I buy alcohol-free beer in Soho before driving?"))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("keeps a question about drinks after driving out of the fitness fence", async () => {
    await expect(resolvePubPalFenceIntent("How long after driving before I can buy beer in Soho?"))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("keeps nonalcoholic beer discovery out of the fitness fence", async () => {
    await expect(resolvePubPalFenceIntent("Where can I buy nonalcoholic beer in Soho before driving?"))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("fences a direct operation question after reported drinking", async () => {
    const query = "I have had two beers in Soho. Can I drive?";
    await expect(resolvePubPalFenceIntent(query))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent(query))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("keeps the drinking verb in an alcohol-free venue search out of the fitness fence", async () => {
    await expect(resolvePubPalFenceIntent("Where can I drink alcohol-free beer in Soho before driving?"))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("keeps safe cycling-route facts out of the personal fitness fence", async () => {
    const query = "Find a safe cycling route to beer gardens in Soho";
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it.each([
    "Where could I drink alcohol-free beer in Soho before driving?",
    "Can I find a pub to drink alcohol-free beer in Soho before driving?",
  ])("preserves equivalent alcohol-free venue discovery: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("fences a direct operation question after reported drunkenness", async () => {
    await expect(resolvePubPalFenceIntent("I'm drunk in Soho. Can I drive?"))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("uses the person's earlier drinking report for a short driving follow-up", async () => {
    const turns: PubPalFenceTurn[] = [
      { role: "user", content: "I have had two beers in Soho." },
    ];
    await expect(resolvePubPalFenceIntent("Can I drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent("Can I drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("retains a drinking report when the driving follow-up names a beer garden", async () => {
    const turns: PubPalFenceTurn[] = [
      { role: "user", content: "I have had two beers in Soho." },
    ];
    await expect(resolvePubPalFenceIntent("Can I drive to a beer garden?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent("Can I drive to a beer garden?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("does not treat an earlier alcohol-free report as alcoholic consumption", async () => {
    await expect(resolvePubPalFenceIntent("Can I drive to a beer garden?", [
      { role: "user", content: "I have had two alcohol-free beers in Soho." },
    ])).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it.each([
    "Can I drink alcohol-free beer in Soho before driving?",
    "I have been drinking alcohol-free beer. Can I drive?",
  ])("preserves an explicitly alcohol-free consumption object: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("does not let an earlier preference mask a later consumption report", async () => {
    const turns: PubPalFenceTurn[] = [
      { role: "user", content: "I like beer." },
      { role: "user", content: "I have had two pints." },
    ];
    await expect(resolvePubPalFenceIntent("Can I drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    await expect(resolvePubPalFenceIntent("I like beer. I have had two pints. Can I drive?"))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("retains alcoholic objects when a report also includes an alcohol-free drink", async () => {
    const report = "I have been drinking alcohol-free beer and two pints.";
    for (const turns of [[], [{ role: "user" as const, content: report }]]) {
      const query = turns.length ? "Can I drive?" : `${report} Can I drive?`;
      await expect(resolvePubPalFenceIntent(query, turns))
        .resolves.toEqual({ fenced: true, sobrietyOnly: true });
      mockSystemOneFromFixture(0.01, 0.01);
      await expect(resolvePubPalFenceIntent(query, turns))
        .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    }
  });

  it.each([
    "I have had trouble finding beer gardens in Soho.",
    "I have had trouble finding pubs and beer gardens in Soho.",
    "I have had trouble finding pubs and wine bars in Soho.",
  ])("does not infer consumption from a beer-garden search: %s", async (report) => {
    await expect(resolvePubPalFenceIntent("Can I drive there?", [
      { role: "user", content: report },
    ])).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it.each([
    "Can I drink only alcohol-free beer in Soho before driving?",
    "I have been drinking only alcohol-free beer. Can I drive?",
  ])("preserves an alcohol-free object qualified by only: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it.each([
    "I have had dinner and two beers.",
    "I have had a couple of beers.",
    "I drank a bottle of wine.",
    "I drank two cold beers.",
    "I have had two cold beers.",
    "I have had 1.5 pints.",
    "I drank red wine.",
  ])("recognizes a consumed amount or mixed meal report: %s", async (report) => {
    await expect(resolvePubPalFenceIntent(`${report} Can I drive?`))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    const turns: PubPalFenceTurn[] = [{ role: "user", content: report }];
    await expect(resolvePubPalFenceIntent("Can I drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent("Can I drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("uses the person's earlier drinking report for an explicit fitness follow-up", async () => {
    const turns: PubPalFenceTurn[] = [{ role: "user", content: "I have had two beers in Soho." }];
    await expect(resolvePubPalFenceIntent("Is it safe to drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
    mockSystemOneFromFixture(0.01, 0.01);
    await expect(resolvePubPalFenceIntent("Is it safe to drive?", turns))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it("does not infer alcohol consumption from water at a wine bar", async () => {
    await expect(resolvePubPalFenceIntent("I drank water in a wine bar. Can I drive?"))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it("does not infer consumption from an assistant's words or a user preference", async () => {
    await expect(resolvePubPalFenceIntent("Can I drive?", [
      { role: "assistant", content: "I have had two beers in Soho." },
    ])).resolves.toEqual({ fenced: false, sobrietyOnly: false });
    await expect(resolvePubPalFenceIntent("Can I drive?", [
      { role: "user", content: "I like beer." },
    ])).resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it.each([
    "Can I drink two pints in Soho before I drive?",
    "How many pints can I have in Soho before driving back?",
    "Before I drive, can I have two pints in Soho?",
    "Would it be safe to drive after two beers?",
    "Am I safe to drive after a pint?",
    "How long after drinking can I drive?",
    "Can I cycle after two pints?",
    "Is one beer okay before riding my bike?",
    "Can I have two beers and still drive?",
  ])("fences personal fitness after alcohol: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query))
      .resolves.toEqual({ fenced: true, sobrietyOnly: true });
  });

  it.each([
    "I am the designated driver. Find alcohol-free pubs in Soho.",
    "What are the parking options near pubs in Soho?",
    "Where can I buy alcohol-free beer in Soho?",
    "Find four quiet pubs in Soho under £7 per pint.",
    "What time does the bus leave Soho?",
    "Before drinking beer, can I drive past Soho?",
    "Can I have a pint in Soho after driving there?",
    "Can I cycle to a pub serving beer in Soho?",
    "Where can I buy 0.0% beer in Soho before driving?",
    "Where can I buy non-alcoholic beer in Soho before driving?",
  ])("preserves discovery and transport without a fitness ask: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query))
      .resolves.toEqual({ fenced: false, sobrietyOnly: false });
  });

  it.each([
    "How many pints can I have in Soho before driving home?",
    "How many pints can I have in Soho before I drive home?",
  ])("fences drinking before driving home: %s", async (query) => {
    await expect(resolvePubPalFenceIntent(query)).resolves.toEqual({
      fenced: true,
      sobrietyOnly: false,
    });
  });

  it("never throws and keeps regex behaviour when systemOne returns null", async () => {
    await expect(
      resolvePubPalFenceIntent("When is the last train home?"),
    ).resolves.toEqual({ fenced: true, sobrietyOnly: false });
    await expect(resolvePubPalFenceIntent("Quiet garden near Soho")).resolves.toEqual({
      fenced: false,
      sobrietyOnly: false,
    });
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
