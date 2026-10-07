import { describe, expect, it } from "vitest";

import { accountIsOut, selectUnreadHosts } from "../scripts/harvest/uk-prices/context-dev-batch.mjs";

describe("context.dev price batch lane", () => {
  const ledger = {
    hosts: {
      "big.example": { outcome: "no-menu-page-found", pubs: 9 },
      "small.example": { outcome: "no-menu-page-found", pubs: 1 },
      "js-only.example": { outcome: "menu-states-no-price", pubs: 4, drops: { "no-price-on-page": 2 } },
      "dropped.example": { outcome: "menu-states-no-price", pubs: 7, drops: { "food-word-nearby": 3, "no-price-on-page": 1 } },
      "refused.example": { outcome: "robots-unreadable", pubs: 20 },
      "dead.example": { outcome: "unreachable", pubs: 20 },
      "chain.example": { outcome: "no-menu-page-found", pubs: 50 },
      "done.example": { outcome: "no-menu-page-found", pubs: 8, contextDev: { outcome: "render-empty" } },
    },
  };

  it("picks only hosts a rendered read could help, most pubs first", () => {
    expect(selectUnreadHosts(ledger, { skipHosts: ["chain.example"] })).toEqual([
      "big.example",
      "js-only.example",
      "small.example",
    ]);
  });

  it("never reruns a host the lane already answered", () => {
    expect(selectUnreadHosts(ledger)).not.toContain("done.example");
  });

  it("stops on a spent account and not on one bad page", () => {
    expect(accountIsOut({ outcome: "fetch-failed", statusCode: 402 })).toBe(true);
    expect(accountIsOut({ outcome: "fetch-failed", reason: "INSUFFICIENT_CREDITS" })).toBe(true);
    expect(accountIsOut({ outcome: "fetch-failed", reason: "TIMEOUT" })).toBe(false);
    expect(accountIsOut({ outcome: "priced" })).toBe(false);
  });
});
