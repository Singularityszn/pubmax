import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the global daily ORS budget. The durable seam (reserveRateLimit) and
// the structured logger are mocked so the budget module's own logic — the
// per-call reservation, the exhausted short-circuit, and the config reader — is
// exercised in isolation, with no Supabase and no real network.

const reserveRateLimit = vi.hoisted(() =>
  vi.fn<() => Promise<{ commit: () => boolean; release: () => Promise<boolean> } | null>>(),
);
const log = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pintDrops", () => ({ reserveRateLimit }));
vi.mock("@/lib/log", () => ({ log }));

import {
  reserveOrsBudget,
  orsBudgetKey,
  orsDailyBudget,
  ORS_BUDGET_WINDOW_MS,
  ORS_DAILY_BUDGET_DEFAULT,
  __resetOrsBudget,
} from "@/lib/walkRouteBudget";

// Two fixed instants on different UTC calendar days.
const DAY1 = Date.parse("2026-07-22T20:00:00Z");
const DAY2 = Date.parse("2026-07-23T09:00:00Z");

beforeEach(() => {
  __resetOrsBudget();
  reserveRateLimit.mockReset();
  log.mockReset();
  reserveRateLimit.mockResolvedValue({ commit: () => true, release: async () => true }); // under budget by default
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("orsDailyBudget (config)", () => {
  it("defaults to ORS_DAILY_BUDGET_DEFAULT when unset", () => {
    expect(orsDailyBudget()).toBe(ORS_DAILY_BUDGET_DEFAULT);
    expect(ORS_DAILY_BUDGET_DEFAULT).toBe(2000);
  });

  it("honours a positive ORS_DAILY_BUDGET override (floored)", () => {
    vi.stubEnv("ORS_DAILY_BUDGET", "500");
    expect(orsDailyBudget()).toBe(500);
    vi.stubEnv("ORS_DAILY_BUDGET", "42.9");
    expect(orsDailyBudget()).toBe(42);
  });

  it("falls back to the default on a non-numeric or non-positive value", () => {
    for (const bad of ["", "  ", "nope", "0", "-100"]) {
      vi.stubEnv("ORS_DAILY_BUDGET", bad);
      expect(orsDailyBudget()).toBe(ORS_DAILY_BUDGET_DEFAULT);
    }
  });
});

describe("orsBudgetKey", () => {
  it("is a single global bucket keyed on the UTC date", () => {
    expect(orsBudgetKey(DAY1)).toBe("ors-global:2026-07-22");
    // 20:00Z + a UTC day boundary — the key rolls at UTC midnight, not local.
    expect(orsBudgetKey(DAY2)).toBe("ors-global:2026-07-23");
  });
});

describe("reserveOrsBudget", () => {
  it("rechecks the budget when an unused reservation is returned after exhaustion", async () => {
    const reservation = await reserveOrsBudget(DAY1);
    reserveRateLimit.mockResolvedValue(null);
    expect(await reserveOrsBudget(DAY1 + 1)).toBeNull();
    await reservation?.release();
    reserveRateLimit.mockResolvedValue({ commit: () => true, release: async () => true });
    expect(await reserveOrsBudget(DAY1 + 2)).not.toBeNull();
    expect(reserveRateLimit).toHaveBeenCalledTimes(3);
  });

  it("draws ONE durable unit against the global bucket and allows the call when under budget", async () => {
    const allowed = await reserveOrsBudget(DAY1);
    expect(allowed).toBeTruthy();
    expect(reserveRateLimit).toHaveBeenCalledTimes(1);
    // Reuses the check_rate_limit seam: same key for local + durable, the
    // configured budget as the limit, and a 24h window.
    expect(reserveRateLimit).toHaveBeenCalledWith(
      "ors-global:2026-07-22",
      ORS_DAILY_BUDGET_DEFAULT,
      ORS_BUDGET_WINDOW_MS,
      undefined,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it("passes the configured ORS_DAILY_BUDGET through as the durable limit", async () => {
    vi.stubEnv("ORS_DAILY_BUDGET", "3");
    await reserveOrsBudget(DAY1);
    expect(reserveRateLimit).toHaveBeenCalledWith(expect.any(String), 3, ORS_BUDGET_WINDOW_MS, undefined);
  });

  it("denies the call and logs ONE structured warn when over budget", async () => {
    reserveRateLimit.mockResolvedValue(null);
    const allowed = await reserveOrsBudget(DAY1);
    expect(allowed).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "ors_budget.exhausted", {
      date: "2026-07-22",
      budget: ORS_DAILY_BUDGET_DEFAULT,
      windowMs: ORS_BUDGET_WINDOW_MS,
    });
  });

  it("short-circuits once exhausted: later calls stay denied with NO extra durable read", async () => {
    reserveRateLimit.mockResolvedValue(null);
    expect(await reserveOrsBudget(DAY1)).toBeNull();
    // Even if the durable limiter would now answer 'under budget', the cached
    // exhausted flag denies without touching it — zero durable reads per request.
    reserveRateLimit.mockResolvedValue({ commit: () => true, release: async () => true });
    expect(await reserveOrsBudget(DAY1 + 1_000)).toBeNull();
    expect(await reserveOrsBudget(DAY1 + 2_000)).toBeNull();
    expect(reserveRateLimit).toHaveBeenCalledTimes(1);
    // And only the first exhaustion logged — one warn per window, not per call.
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("scopes the short-circuit to the UTC day: a new day re-checks the durable budget", async () => {
    reserveRateLimit.mockResolvedValue(null);
    expect(await reserveOrsBudget(DAY1)).toBeNull();
    expect(reserveRateLimit).toHaveBeenCalledTimes(1);
    // Next UTC day: fresh bucket, the stale exhausted flag must not hold it down.
    reserveRateLimit.mockResolvedValue({ commit: () => true, release: async () => true });
    expect(await reserveOrsBudget(DAY2)).toBeTruthy();
    expect(reserveRateLimit).toHaveBeenCalledTimes(2);
    expect(reserveRateLimit).toHaveBeenLastCalledWith(
      "ors-global:2026-07-23",
      ORS_DAILY_BUDGET_DEFAULT,
      ORS_BUDGET_WINDOW_MS,
      undefined,
    );
  });

  it("DEGRADED MODE (documented): delegates to reserveRateLimit, inheriting its fail-open-to-memory seam", async () => {
    // The budget owns no limiter of its own — it rides the SAME reserveRateLimit path
    // every rate-limited route uses. So when Supabase can't answer, the budget
    // degrades to a per-instance in-memory counter exactly as reserveRateLimit does
    // (looser than ORS_DAILY_BUDGET by the live instance count), and never hard
    // stops routing. Proven here by the single delegation; the fail-open logic
    // itself is covered by the pintDrops limiter tests.
    await reserveOrsBudget(DAY1);
    expect(reserveRateLimit).toHaveBeenCalledTimes(1);
  });
});
