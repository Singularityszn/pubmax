import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";

it("initializes and parses plan prices when RegExp lookbehind is unavailable", async () => {
  const nativeRegExp = RegExp;
  const legacyRegExp = new Proxy(nativeRegExp, {
    construct(target, args) {
      const pattern = String(args[0]);
      if (pattern.includes("(?<=") || pattern.includes("(?<!")) {
        throw new SyntaxError("Lookbehind is unavailable");
      }
      return Reflect.construct(target, args);
    },
  });
  vi.stubGlobal("RegExp", legacyRegExp);
  try {
    expect(() => new RegExp("(?<!x)y")).toThrow(SyntaxError);
    vi.resetModules();
    const { planPriceLimits, planPriceSubjectText } = await import("@/lib/planPriceLimits");
    for (const rate of ["£5 pint", "pint under £ 5", "pint under5 pounds", "pint under5 quid"]) {
      expect(planPriceLimits(`${rate} serving pizza, pub route budget of£20`))
        .toEqual({ pintCeiling: 5, routeBudgetPence: 2000 });
    }
    for (const object of ["beer", "drinks", "real ale", "cider", "soft drinks", "mixed drinks and food", "craft beverages"]) {
      for (const antecedent of ["", "each ", "one ", "two ", "each regularly ", "with a garden ", "with a sunny terrace regularly ", "with a kitchen ", "with a restaurant ", "with a rooftop ", "with 2 bars ", "with a shed "]) {
        expect(planPriceLimits(`£5 pint at X ${antecedent}serving ${object}, under£20 per person`))
          .toEqual({ pintCeiling: 5, routeBudgetPence: 2000 });
      }
    }
    for (const subject of ["a serving weighing 200g", "one serving enough for two", "a generous serving suitable for sharing", "each serving weighing 200g", "a 200g serving weighing 200g", "one warm serving weighing 200g", "one serving containing nuts", "a softly warmed generous serving containing nuts"]) {
      expect(planPriceSubjectText(`£10 pint at X&${subject}`)).toContain(`&${subject}`);
      expect(planPriceSubjectText(`${subject} under£10`)).toBe(`${subject} under£10`);
    }
    expect(planPriceSubjectText("£10 pint at X and servings to share"))
      .toContain("and servings to share");
    expect(planPriceSubjectText("£10 pint at X and 2 servings for two"))
      .toContain("and 2 servings for two");
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});


it("parses long measurement antecedents without blocking the public price parser", () => {
  const queries = ["1g ", "1 g "].map((measure) =>
    `with one ${measure.repeat(30)}at X serving beer, under£20 per person`);
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { planPriceLimits } from "./lib/planPriceLimits.ts";
    const queries = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(queries.map((query) => planPriceLimits(query))));
  `, JSON.stringify(queries)], { encoding: "utf8", timeout: 5000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    { pintCeiling: null, routeBudgetPence: 2000 },
    { pintCeiling: null, routeBudgetPence: 2000 },
  ]);
});
