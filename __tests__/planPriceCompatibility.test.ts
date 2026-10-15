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
      for (const antecedent of ["", "each ", "each regularly ", "with a garden ", "with a sunny terrace regularly "]) {
        expect(planPriceLimits(`£5 pint at X ${antecedent}serving ${object}, under£20 per person`))
          .toEqual({ pintCeiling: 5, routeBudgetPence: 2000 });
      }
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
