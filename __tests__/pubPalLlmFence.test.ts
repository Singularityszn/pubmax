import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import probabilities from "@/__tests__/fixtures/typesafe/pubPalFenceProbabilities.json";
import {
  isPubPalGetHomeOrSobrietyIntent,
  isPubPalSobrietyOnlyIntent,
  pubPalFenceFromNouls,
  PUB_PAL_FENCE_NOUL_THRESHOLD,
  type PubPalFenceTurn,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import { PUB_PAL_FENCE_QUESTION_IDS } from "@/lib/pubPalLlmFenceQuestions";

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOne: vi.fn(),
}));

import { systemOne } from "@/lib/ai/typesafe.server";

const ROOT = process.cwd();

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
    const comment = readFileSync(join(ROOT, "lib/pubPalLlmFence.ts"), "utf8");
    expect(comment).toContain("__tests__/fixtures/typesafe/pubPalFenceProbabilities.json");
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
});

describe("Pub Pal fence without TypeSafe key", () => {
  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    vi.mocked(systemOne).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.mocked(systemOne).mockReset();
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
