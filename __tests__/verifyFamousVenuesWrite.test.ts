import { describe, expect, it } from "vitest";

import { applyVerification, summarizeVerification } from "@/scripts/verify_famous_venues.mjs";

type Row = { id: string; name: string; observedAt: string; expiresAt: string };

const row = (id: string): Row => ({
  id,
  name: id,
  observedAt: "2026-08-25",
  expiresAt: "2026-09-24",
});

describe("verify:famous-venues --write plan", () => {
  it("re-stamps confirmed rows, drops closed rows and keeps unverified rows unchanged", () => {
    const packs = new Map([
      ["bars.json", [row("bar-open"), row("bar-closed"), row("bar-timeout")]],
      ["late_food.json", [row("food-429")]],
    ]);

    const next = applyVerification(
      packs,
      [
        { id: "bar-open", outcome: "confirmed" },
        { id: "bar-closed", outcome: "closed" },
        { id: "bar-timeout", outcome: "unverified" },
        { id: "food-429", outcome: "unverified" },
      ],
      "2026-09-24",
    );

    expect(next.get("bars.json")).toEqual([
      { ...row("bar-open"), observedAt: "2026-09-24", expiresAt: "2026-10-24" },
      row("bar-timeout"),
    ]);
    expect(next.get("late_food.json")).toEqual([row("food-429")]);
  });

  it("buckets checks by outcome, counting confirmed rows and listing closed and unverified ids", () => {
    expect(
      summarizeVerification([
        { id: "bar-operational", outcome: "confirmed" },
        { id: "food-operational", outcome: "confirmed" },
        { id: "bar-no-confident-match", outcome: "unverified" },
        { id: "bar-closed", outcome: "closed" },
      ]),
    ).toEqual({
      rowsChecked: 4,
      confirmed: 2,
      closed: ["bar-closed"],
      unverified: ["bar-no-confident-match"],
    });
  });
});
