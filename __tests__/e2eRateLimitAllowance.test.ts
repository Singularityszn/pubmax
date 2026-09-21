import { afterEach, describe, expect, it } from "vitest";

import { applyE2ERateLimitAllowance } from "@/lib/e2eRateLimitAllowance";

describe("applyE2ERateLimitAllowance", () => {
  const original = process.env.PUBMAX_E2E_RATE_LIMIT_MAX;

  afterEach(() => {
    if (original === undefined) delete process.env.PUBMAX_E2E_RATE_LIMIT_MAX;
    else process.env.PUBMAX_E2E_RATE_LIMIT_MAX = original;
  });

  it("leaves production budgets alone when the e2e env is unset", () => {
    delete process.env.PUBMAX_E2E_RATE_LIMIT_MAX;
    expect(applyE2ERateLimitAllowance(8)).toBe(8);
    expect(applyE2ERateLimitAllowance(60)).toBe(60);
  });

  it("never lowers a tighter caller budget", () => {
    process.env.PUBMAX_E2E_RATE_LIMIT_MAX = "100";
    expect(applyE2ERateLimitAllowance(240)).toBe(240);
  });

  it("raises the budget when Playwright sets a positive integer", () => {
    process.env.PUBMAX_E2E_RATE_LIMIT_MAX = "10000";
    expect(applyE2ERateLimitAllowance(8)).toBe(10000);
    expect(applyE2ERateLimitAllowance(60)).toBe(10000);
  });

  it("ignores junk so a mistyped env cannot open the limiter", () => {
    process.env.PUBMAX_E2E_RATE_LIMIT_MAX = "nope";
    expect(applyE2ERateLimitAllowance(8)).toBe(8);
    process.env.PUBMAX_E2E_RATE_LIMIT_MAX = "-1";
    expect(applyE2ERateLimitAllowance(8)).toBe(8);
    process.env.PUBMAX_E2E_RATE_LIMIT_MAX = "0";
    expect(applyE2ERateLimitAllowance(8)).toBe(8);
  });
});
