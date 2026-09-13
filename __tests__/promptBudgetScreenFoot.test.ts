import { describe, expect, it } from "vitest";

import {
  claimScreenFoot,
  hasScreenFootFor,
  promptBudgetHolder,
  routeOwnsScreenFoot,
} from "@/lib/promptBudget";

// ONE PROMPT CLAIMS THE FOOT OF THE SCREEN AT A TIME, AND THE MAP IS ALREADY
// USING IT. Site audit 13 Sep 2026, D3: on the phone map the consent card was
// lifted above "Describe the outing" and, with the top chrome and the dock,
// 38 percent of the map was chrome. The map's own foot (the outing pill, the
// dock) is the map's answer, so an interruptive prompt waits for the next
// route there instead of stacking on top of it. These are the claim-order
// rules that decide it.

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("routeOwnsScreenFoot", () => {
  it.each(["/map", "/map/", "/map/london", "/map/london/soho", "/map?sel=venue-1", "/map#log"])(
    "answers true for the map family: %s",
    (pathname) => {
      expect(routeOwnsScreenFoot(pathname)).toBe(true);
    },
  );

  it.each(["/", "/tonight", "/places", "/mapping", "/maps", "/plan", "/u/you"])(
    "answers false off the map: %s",
    (pathname) => {
      expect(routeOwnsScreenFoot(pathname)).toBe(false);
    },
  );

  it.each([null, undefined, ""])("answers false for a pathname it cannot read: %s", (pathname) => {
    expect(routeOwnsScreenFoot(pathname)).toBe(false);
  });
});

describe("screen foot claim order", () => {
  it("claims nothing and spends nothing on a route that owns its foot", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();

    expect(hasScreenFootFor("analytics-consent", "/map", session, local)).toBe(false);
    expect(claimScreenFoot("analytics-consent", "/map", session, local)).toBe(false);
    expect(claimScreenFoot("analytics-consent", "/map/london", session, local)).toBe(false);
    // The wait costs the session nothing: the slot is still free for the next route.
    expect(promptBudgetHolder(session)).toBeNull();
  });

  it("gives the deferred analytics choice the first claim on the next route", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();

    expect(claimScreenFoot("analytics-consent", "/map", session, local)).toBe(false);
    // An undecided analytics choice keeps priority off the map as well.
    expect(claimScreenFoot("a2hs", "/tonight", session, local)).toBe(false);
    expect(promptBudgetHolder(session)).toBeNull();

    expect(claimScreenFoot("analytics-consent", "/tonight", session, local)).toBe(true);
    expect(promptBudgetHolder(session)).toBe("analytics-consent");

    // Only one prompt claims the foot: every later surface is refused.
    expect(claimScreenFoot("a2hs", "/places", session, local)).toBe(false);
    expect(claimScreenFoot("identity-nudge", "/places", session, local)).toBe(false);
    expect(promptBudgetHolder(session)).toBe("analytics-consent");
  });

  it("stands the holder down on the map and lets it back on the next route", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();

    expect(claimScreenFoot("analytics-consent", "/tonight", session, local)).toBe(true);
    expect(hasScreenFootFor("analytics-consent", "/map", session, local)).toBe(false);
    expect(claimScreenFoot("analytics-consent", "/map/london", session, local)).toBe(false);
    // Standing down is not a release: the holder keeps the slot it spent.
    expect(promptBudgetHolder(session)).toBe("analytics-consent");

    expect(hasScreenFootFor("analytics-consent", "/places", session, local)).toBe(true);
    expect(claimScreenFoot("analytics-consent", "/places", session, local)).toBe(true);
  });

  it("lets a later session's prompt compete once analytics is decided, but never on the map", () => {
    const session = makeMemoryStorage();
    const local = makeMemoryStorage();
    local.setItem("pubmaxx:analytics-consent:v1", "denied");

    expect(claimScreenFoot("a2hs", "/map", session, local)).toBe(false);
    expect(promptBudgetHolder(session)).toBeNull();
    expect(claimScreenFoot("a2hs", "/tonight", session, local)).toBe(true);
    expect(promptBudgetHolder(session)).toBe("a2hs");
  });
});
