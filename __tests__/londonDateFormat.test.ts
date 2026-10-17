import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatLedgerDate } from "@/lib/ledger";
import { selectedDrinkPriceDescription } from "@/lib/planSelectedDrinkPriceEvidence";

// LIB-D8 / PAGE-8: a date a drinker reads is a London date. The server runs in
// UTC, so 23:30Z on a BST night is already the next London day. The host zone
// is pinned to UTC here so the proof does not depend on the machine.
const BST_PAST_MIDNIGHT = "2024-06-03T23:30:00.000Z";

let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe("dates are read on the London calendar", () => {
  it("dates a ledger entry logged at 00:30 BST on the London day", () => {
    expect(formatLedgerDate(BST_PAST_MIDNIGHT)).toBe("4 June 2024");
  });

  it("dates a community drink report logged at 00:30 BST on the London day", () => {
    expect(selectedDrinkPriceDescription({
      category: "wine", pence: 550, serving: null, source: "community", reportedAt: BST_PAST_MIDNIGHT,
    })).toBe("Wine £5.50, community report 4 Jun 2024. Serving size not recorded.");
  });

  it("names the London zone on the pint drop permalink's server-rendered date", () => {
    const source = readFileSync(join(process.cwd(), "app/p/[id]/page.tsx"), "utf8");
    const calls = source.match(/toLocaleDateString\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('timeZone: "Europe/London"');
  });
});
