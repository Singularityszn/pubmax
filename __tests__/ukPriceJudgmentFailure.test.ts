import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/typesafe.server.ts", () => ({
  systemOneOutcome: vi.fn(),
}));

vi.mock("@/lib/harvest/ukPriceJudgmentBatch.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harvest/ukPriceJudgmentBatch.ts")>();
  return {
    ...actual,
    batchUkPriceCandidates: vi.fn(actual.batchUkPriceCandidates),
  };
});

import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { batchUkPriceCandidates } from "@/lib/harvest/ukPriceJudgmentBatch";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import type { UkPriceRawCandidate } from "@/lib/harvest/ukPriceCrawl";
import { readVenueDrinkPricesJudged } from "@/lib/harvest/ukPriceJudgment.server";

const drinksList = `
<html><body>
  <p>Madri pint &pound;6.20</p>
  <p>Guinness pint &pound;6.40</p>
  <p>Neck Oil pint &pound;6.80</p>
</body></html>`;

function mockAnswersForBatch(questionMap: Record<string, unknown>) {
  const count = Object.keys(questionMap).filter((key) => key.startsWith("whatIsPriced_")).length;
  const answers: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    answers[`whatIsPriced_${index}`] = {
      type: "choice",
      choice: "draught_pint",
      probabilities: { draught_pint: 0.95 },
    };
    answers[`isPromotionalPrice_${index}`] = { type: "noul", noul: 0.01 };
    answers[`drinkCategory_${index}`] = {
      type: "choice",
      choice: "beer",
      probabilities: { beer: 0.95 },
    };
  }
  return {
    status: "ok" as const,
    result: {
      model: "jev-test",
      usage: { input_tokens: 1, output_tokens: 1 },
      answers,
    },
  } as Awaited<ReturnType<typeof systemOneOutcome>>;
}

describe("readVenueDrinkPricesJudged batch failures", () => {
  it("records a budget drop and keyless-falls back only the refused batch", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(batchUkPriceCandidates).mockReturnValueOnce([
      [{ priceGbp: 6.2, verbatim: "£6.20", snippet: "Madri pint £6.20", priceText: "£6.20" }],
      [
        { priceGbp: 6.4, verbatim: "£6.40", snippet: "Guinness pint £6.40", priceText: "£6.40" },
        { priceGbp: 6.8, verbatim: "£6.80", snippet: "Neck Oil pint £6.80", priceText: "£6.80" },
      ],
    ] as UkPriceRawCandidate[][]);

    vi.mocked(systemOneOutcome)
      .mockImplementationOnce(async (_state, questions) => mockAnswersForBatch(questions))
      .mockResolvedValueOnce({ status: "skipped", reason: "budget" });

    const judged = await readVenueDrinkPricesJudged(drinksList, {
      pubName: "The Crown",
      pageUrl: "https://thecrown.co.uk/drinks",
    });

    expect(systemOneOutcome).toHaveBeenCalledTimes(2);
    expect(judged.kept.some((row) => row.priceGbp === 6.2)).toBe(true);
    expect(judged.drops).toContain("typesafe-judgment-budget-refused");
    const keylessSecondBatch = readVenueDrinkPrices(drinksList).kept.filter(
      (row) => row.priceGbp === 6.4 || row.priceGbp === 6.8,
    );
    expect(judged.kept.filter((row) => row.priceGbp === 6.4 || row.priceGbp === 6.8)).toEqual(
      keylessSecondBatch,
    );

    vi.unstubAllEnvs();
    vi.mocked(systemOneOutcome).mockReset();
    vi.mocked(batchUkPriceCandidates).mockRestore();
  });

  it("uses far fewer calls than serial one-per-figure judgment", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const lines = Array.from({ length: 60 }, (_, index) => `<p>Beer ${index} pint &pound;6.20</p>`).join(
      "",
    );
    const html = `<html><body>${lines}</body></html>`;

    vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) =>
      mockAnswersForBatch(questions),
    );

    await readVenueDrinkPricesJudged(html, {
      pubName: "The Crown",
      pageUrl: "https://thecrown.co.uk/drinks",
    });

    expect(vi.mocked(systemOneOutcome).mock.calls.length).toBeLessThan(10);
    vi.unstubAllEnvs();
    vi.mocked(systemOneOutcome).mockReset();
  });
});
