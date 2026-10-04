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
import {
  decideKeylessUkPriceCandidate,
  cheapestPerCategory,
  findUkPriceCandidates,
  pageText,
  readVenueDrinkPrices,
} from "@/lib/harvest/ukPriceCrawl";
import type { UkPriceRawCandidate } from "@/lib/harvest/ukPriceCrawl";
import { readVenueDrinkPricesJudged } from "@/lib/harvest/ukPriceJudgment.server";
import { defined } from "@/__tests__/helpers/defined";

const drinksList = `
<html><body>
  <p>Madri pint &pound;6.20</p>
  <p>Guinness pint &pound;6.40</p>
  <p>Neck Oil pint &pound;6.80</p>
</body></html>`;

function mockAnswersForBatch(
  questionMap: Record<string, unknown>,
  what: "draught_pint" | "wine_glass" = "draught_pint",
) {
  const count = Object.keys(questionMap).filter((key) => key.startsWith("whatIsPriced_")).length;
  const answers: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    answers[`whatIsPriced_${index}`] = {
      type: "choice",
      choice: what,
      probabilities: { [what]: 0.95 },
    };
    answers[`isPromotionalPrice_${index}`] = { type: "noul", noul: 0.01 };
    answers[`drinkCategory_${index}`] = {
      type: "choice",
      choice: what === "wine_glass" ? "wine" : "beer",
      probabilities: { [what === "wine_glass" ? "wine" : "beer"]: 0.95 },
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
  it.each(["accepted", "budget", "timeout", "error", "malformed"])(
    "retains named wine pairs with separators on %s judgment", async (mode) => {
      vi.stubEnv("TYPESAFE_API_KEY", "test-key");
      vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) => {
        if (mode === "accepted") return mockAnswersForBatch(questions, "wine_glass");
        if (mode === "budget") return { status: "skipped", reason: "budget" };
        if (mode === "timeout" || mode === "error") return { status: "failed", reason: mode };
        const answer = mockAnswersForBatch(questions);
        return answer.status === "ok"
          ? { ...answer, result: { ...answer.result, answers: {} } }
          : answer;
      });
      try {
        for (const separator of ["/", "-", "\u2013", "\u2014", "|"]) {
          const judged = await readVenueDrinkPricesJudged(
            `<div class="menubox"><h2>Wine</h2>
            <p>Rioja 125ml £5.25 ${separator} 250ml £10.50</p>
            <p>Chardonnay 125ml £6.50 ${separator} 250ml £13.00</p></div>`,
            { pubName: "The Crown", pageUrl: "https://thecrown.co.uk/drinks" },
          );
          expect(cheapestPerCategory(judged)).toEqual([
            { category: "wine", drinkLabel: "Chardonnay", servingSize: "125ml", priceGbp: 6.5 },
            { category: "wine", drinkLabel: "Chardonnay", servingSize: "250ml", priceGbp: 13 },
            { category: "wine", drinkLabel: "Rioja", servingSize: "125ml", priceGbp: 5.25 },
            { category: "wine", drinkLabel: "Rioja", servingSize: "250ml", priceGbp: 10.5 },
          ]);
        }
        if (mode !== "accepted") {
          for (const container of ["section", "article", 'div class="menubox"']) {
            const judged = await readVenueDrinkPricesJudged(
              `<${container}><p>Orchard Light 125ml £4.50 250ml £6.50</p>
              <h2>Wine</h2><p>Gavi de Gavi 125ml £7.00 250ml £14.00</p>
              <h2>Soft drinks</h2><p>Garden Fizz 125ml £4.00 250ml £6.00</p>
              </${container.split(" ")[0]}>`,
              { pubName: "The Crown", pageUrl: "https://thecrown.co.uk/drinks" },
            );
            expect(judged.kept.filter((row) => row.category === "wine")).toEqual([
              expect.objectContaining({ drinkLabel: "Gavi de Gavi", servingSize: "125ml", priceGbp: 7 }),
              expect.objectContaining({ drinkLabel: "Gavi de Gavi", servingSize: "250ml", priceGbp: 14 }),
            ]);
          }
        }
      } finally {
        vi.unstubAllEnvs();
        vi.mocked(systemOneOutcome).mockReset();
      }
    },
  );

  it.each([
    { status: "skipped", reason: "budget" },
    { status: "failed", reason: "timeout" },
    { status: "failed", reason: "error" },
    { status: "ok", result: { answers: {} } },
  ])("preserves strength and paired-glass identity after %j", async (failure) => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOneOutcome).mockResolvedValue(
      failure as Awaited<ReturnType<typeof systemOneOutcome>>,
    );
    try {
      for (const strength of ["4.0%", "10.0%", "0.5%", "0%", "0.0%", "0.00%", "alcohol-free"]) {
        const judged = await readVenueDrinkPricesJudged(`<p>Shenanigans Lager ${strength} £3.70</p>`, {
          pubName: "The Crown", pageUrl: "https://thecrown.co.uk/drinks",
        });
        expect(judged.kept).toEqual([expect.objectContaining({
          category: ["4.0%", "10.0%", "0.5%"].includes(strength) ? "beer" : "alcohol-free",
          priceGbp: 3.7,
        })]);
      }
      const judged = await readVenueDrinkPricesJudged(
        `<p>Rioja 125ml £5.25 250ml £10.50</p><p>Gordon's gin £8.00</p><p>Madri pint £6.20</p>`,
        { pubName: "The Crown", pageUrl: "https://thecrown.co.uk/drinks" },
      );
      expect(judged.kept).toEqual([
        expect.objectContaining({ category: "wine", drinkLabel: "Rioja", servingSize: "125ml", priceGbp: 5.25 }),
        expect.objectContaining({ category: "wine", drinkLabel: "Rioja", servingSize: "250ml", priceGbp: 10.5 }),
        expect.objectContaining({ category: "gin", drinkLabel: "Gordon's gin", priceGbp: 8 }),
        expect.objectContaining({ category: "beer", drinkLabel: "Madri pint", priceGbp: 6.2 }),
      ]);
      const separated = await readVenueDrinkPricesJudged(
        `<p>Rioja 125ml £5.25</p><p>250ml £10.50</p><p>Gordon's gin £8.00</p>`,
        { pubName: "The Crown", pageUrl: "https://thecrown.co.uk/drinks" },
      );
      expect(separated.kept.some((row) => row.priceGbp === 10.5)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });

  it.each([
    [{ status: "skipped", reason: "budget" }, "typesafe-judgment-budget-refused"],
    [{ status: "failed", reason: "timeout" }, "typesafe-judgment-call-timeout"],
    [{ status: "failed", reason: "error" }, "typesafe-judgment-call-error"],
    [{ status: "ok", result: { answers: {} } }, "typesafe-judgment-malformed-answer"],
  ])("retains section-scoped glasses after %j", async (failure, drop) => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOneOutcome).mockResolvedValue(
      failure as Awaited<ReturnType<typeof systemOneOutcome>>,
    );
    const menu = `<div class="menubox"><h1>white</h1>
      <p>Gavi de Gavi, Italy<br />125ml £7.00 250ml £14.00 Btl £39.95</p></div>
      <div class="menubox"><h1>soft drinks</h1>
      <p>Garden Fizz<br />125ml £2.50 250ml £4.00</p></div>`;
    try {
      const judged = await readVenueDrinkPricesJudged(menu, {
        pubName: "Sydney Arms",
        pageUrl: "https://www.sydneyarmschelsea.com/menu/",
      });
      expect(judged.kept.filter((row) => row.category === "wine").map(
        ({ drinkLabel, servingSize, priceGbp }) => ({ drinkLabel, servingSize, priceGbp }),
      )).toEqual([
        { drinkLabel: "Gavi de Gavi, Italy", servingSize: "125ml", priceGbp: 7 },
        { drinkLabel: "Gavi de Gavi, Italy", servingSize: "250ml", priceGbp: 14 },
      ]);
      expect(judged.kept).toEqual(readVenueDrinkPrices(menu).kept);
      expect(judged.drops.filter((reason) => reason === drop)).toHaveLength(5);
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });

  it("retains printed wine names and glass sizes on the accepted judged path", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    // Minimal excerpt from the permission-checked Sydney Arms capture.
    const menu = `<p>Chardonnay, Pays D&#8217;oc, France<br />
125ml £5.50 250ml £11.00 Btl £31.50</p>`;
    vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) =>
      mockAnswersForBatch(questions, "wine_glass"),
    );

    try {
      const judged = await readVenueDrinkPricesJudged(menu, {
        pubName: "Sydney Arms",
        pageUrl: "https://www.sydneyarmschelsea.com/menu/",
      });
      expect(judged.kept.map(({ drinkLabel, servingSize, priceGbp }) => ({ drinkLabel, servingSize, priceGbp }))).toEqual([
        { drinkLabel: "Chardonnay, Pays D’oc, France", servingSize: "125ml", priceGbp: 5.5 },
        { drinkLabel: "Chardonnay, Pays D’oc, France", servingSize: "250ml", priceGbp: 11 },
      ]);
      expect(judged.drops).toContain("outside-category-band");
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });

  it("does not attach an earlier item's wine identity to an accepted judged price", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) =>
      mockAnswersForBatch(questions, "wine_glass"),
    );
    try {
      const judged = await readVenueDrinkPricesJudged(
        `<p>Rioja 125ml £5.25</p><p>250ml £10.50</p>`,
        { pubName: "The Crown", pageUrl: "https://thecrown.co.uk/drinks" },
      );
      expect(judged.kept.find((row) => row.priceGbp === 5.25)).toMatchObject({
        drinkLabel: "Rioja", servingSize: "125ml",
      });
      expect(judged.kept.find((row) => row.priceGbp === 10.5)).toMatchObject({ drinkLabel: "250ml" });
      expect(judged.kept.find((row) => row.priceGbp === 10.5)).not.toHaveProperty("servingSize");
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });

  it("records a budget drop and keyless-falls back only the refused batch", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    // Offsets come from the page, never hand-written: a candidate carries where
    // it was, and the keyless fallback reads it there. See the offset test below.
    const pageCandidates = findUkPriceCandidates(pageText(drinksList), 120);
    const byPrice = (gbp: number) => {
      const found = pageCandidates.find((row) => row.priceGbp === gbp);
      if (!found) throw new Error(`no candidate for ${gbp}`);
      return found;
    };
    vi.mocked(batchUkPriceCandidates).mockReturnValueOnce([
      [byPrice(6.2)],
      [byPrice(6.4), byPrice(6.8)],
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

  // A page prices two different things at the same figure all the time. The
  // keyless re-read used to search for the verbatim string, so BOTH candidates
  // were read in the context of whichever came first: the supper was published
  // with the pint's category, and the pint was published twice. The fallback is
  // the failure path, so a false publish there is a false price on the map.
  it("reads each repeated figure at its own offset, not the first match", async () => {
    const filler = `<p>${"Our kitchen serves hearty plates every day of the week. ".repeat(6)}</p>`;
    const html = `<html><body><p>Madri pint &pound;6.20</p>${filler}<p>Steak and chips supper &pound;6.20</p></body></html>`;
    const text = pageText(html, true);
    const candidates = findUkPriceCandidates(text, 120);
    expect(candidates).toHaveLength(2);
    expect(defined(candidates[0]).at).toBeLessThan(defined(candidates[1]).at);

    const decisions = candidates.map((raw) => decideKeylessUkPriceCandidate(text, raw));

    // The fallback agrees with the keyless reader it falls back to, row for row.
    const truth = readVenueDrinkPrices(html);
    expect(decisions.filter((d) => d.kept).map((d) => d.kept)).toEqual(truth.kept);
    expect(defined(decisions[0]).kept?.category).toBe("beer");
    expect(defined(decisions[1]).kept).toBeUndefined();

    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOneOutcome).mockResolvedValue({ status: "failed", reason: "timeout" });
    try {
      const judged = await readVenueDrinkPricesJudged(html, {
        pubName: "The Crown",
        pageUrl: "https://thecrown.co.uk/drinks",
      });
      expect(judged.kept).toEqual(truth.kept);
      expect(judged.drops).toContain("no-category-word-nearby");
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });
});
