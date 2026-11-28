import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTRACT_CREDIT_COST,
  SEARCH_CREDIT_COST,
  openSpendLedger,
  reportedCredits,
} from "@/lib/harvest/tavilyNightlyBudget";

const searchFixture = JSON.parse(readFileSync(
  path.join(__dirname, "fixtures", "tavily-nightly", "eastbrook-search.json"), "utf8",
));

describe("hard stop", () => {
  it("refuses another call once the allowance is spent, and counts an in-flight overshoot", () => {
    const ledger = openSpendLedger(2);
    expect(ledger.canSpend(SEARCH_CREDIT_COST)).toBe(true);
    ledger.record(2);
    expect(ledger.spent).toBe(2);
    expect(ledger.canSpend(1)).toBe(false);
    expect(ledger.exhausted).toBe(true);
  });

  it("counts a recorded response's credits and falls back high when the body omits them", () => {
    expect(reportedCredits(searchFixture, SEARCH_CREDIT_COST)).toBe(1);
    expect(reportedCredits({}, EXTRACT_CREDIT_COST)).toBe(EXTRACT_CREDIT_COST);
    expect(reportedCredits({ usage: { credits: -3 } }, 1)).toBe(1);
  });
});
