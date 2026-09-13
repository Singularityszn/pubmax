import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  CONSENT_ANSWER_KINDS,
  CONSENT_ANSWER_MOMENT_KEY,
  CONSENT_FIRST_ROUTE_KEY,
  consentAnswerMoment,
  hasAnsweredThisSession,
  isConsentAnswerKind,
  markConsentAnswerMoment,
  noteConsentRouteVisited,
} from "@/lib/consentAnswerMoment";

/** A Storage double with no browser behind it, so each case starts empty. */
function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() { return rows.size; },
    clear: () => rows.clear(),
    getItem: (key: string) => rows.get(key) ?? null,
    key: (index: number) => [...rows.keys()][index] ?? null,
    removeItem: (key: string) => { rows.delete(key); },
    setItem: (key: string, value: string) => { rows.set(key, value); },
  } as Storage;
}

/** A storage that refuses every call, which is private mode and a full disk. */
function refusingStorage(): Storage {
  const refuse = () => { throw new Error("storage unavailable"); };
  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  } as unknown as Storage;
}

describe("what counts as the product having answered", () => {
  it("holds a closed set, so a kind nobody declared counts as nothing", () => {
    expect([...CONSENT_ANSWER_KINDS]).toEqual([
      "venue-sheet",
      "pal-reply",
      "second-route",
    ]);
    expect(isConsentAnswerKind("venue-sheet")).toBe(true);
    expect(isConsentAnswerKind("scrolled")).toBe(false);
    expect(isConsentAnswerKind(null)).toBe(false);
    expect(isConsentAnswerKind(3)).toBe(false);
  });

  it("waits until a real answer lands", () => {
    const store = memoryStorage();
    expect(consentAnswerMoment(store)).toBe(null);
    expect(hasAnsweredThisSession(store)).toBe(false);

    markConsentAnswerMoment("venue-sheet", store);
    expect(consentAnswerMoment(store)).toBe("venue-sheet");
    expect(hasAnsweredThisSession(store)).toBe(true);
  });

  it("names the moment the wait ENDED, so a later answer writes nothing", () => {
    const store = memoryStorage();
    markConsentAnswerMoment("pal-reply", store);
    markConsentAnswerMoment("venue-sheet", store);
    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBe("pal-reply");
  });

  it("refuses a kind outside the table rather than storing it", () => {
    const store = memoryStorage();
    markConsentAnswerMoment("first-scroll" as never, store);
    expect(consentAnswerMoment(store)).toBe(null);
  });

  it("reads a value it did not write as no answer at all", () => {
    const store = memoryStorage();
    store.setItem(CONSENT_ANSWER_MOMENT_KEY, "yes");
    expect(consentAnswerMoment(store)).toBe(null);
  });

  it("keeps waiting when storage cannot be read, never claiming an answer", () => {
    // The cautious side: with no marker the card stays off an arrival rather
    // than painting over it.
    expect(consentAnswerMoment(refusingStorage())).toBe(null);
    expect(hasAnsweredThisSession(refusingStorage())).toBe(false);
    expect(() => markConsentAnswerMoment("venue-sheet", refusingStorage()))
      .not.toThrow();
    expect(consentAnswerMoment(null)).toBe(null);
  });
});

describe("reaching a second route is one of those answers", () => {
  it("remembers the first route and answers nothing for it", () => {
    const store = memoryStorage();
    noteConsentRouteVisited("/tonight", store);
    expect(store.getItem(CONSENT_FIRST_ROUTE_KEY)).toBe("/tonight");
    expect(hasAnsweredThisSession(store)).toBe(false);
  });

  it("does not count the same route again, however many times it paints", () => {
    const store = memoryStorage();
    noteConsentRouteVisited("/tonight", store);
    noteConsentRouteVisited("/tonight", store);
    noteConsentRouteVisited("/tonight", store);
    expect(hasAnsweredThisSession(store)).toBe(false);
  });

  it("counts a DIFFERENT route as the answer", () => {
    const store = memoryStorage();
    noteConsentRouteVisited("/", store);
    noteConsentRouteVisited("/tonight", store);
    expect(consentAnswerMoment(store)).toBe("second-route");
  });

  it("ignores a pathname it cannot read, which a transition can hand it", () => {
    const store = memoryStorage();
    noteConsentRouteVisited(null, store);
    noteConsentRouteVisited(undefined, store);
    noteConsentRouteVisited("", store);
    expect(store.getItem(CONSENT_FIRST_ROUTE_KEY)).toBe(null);
    expect(hasAnsweredThisSession(store)).toBe(false);
  });

  it("does not overwrite an answer that already landed", () => {
    const store = memoryStorage();
    markConsentAnswerMoment("venue-sheet", store);
    noteConsentRouteVisited("/", store);
    noteConsentRouteVisited("/tonight", store);
    expect(consentAnswerMoment(store)).toBe("venue-sheet");
  });
});

describe("the module is a leaf and writes no analytics", () => {
  const source = readFileSync("lib/consentAnswerMoment.ts", "utf8");

  it("imports the storage helper and nothing else", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/safeStorage"]);
  });

  it("sends no beacon of its own", () => {
    expect(source).not.toContain("trackEvent");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("sendBeacon");
  });
});

describe("the surfaces that report an answer", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("marks the moment where both pub layers already report a sheet open", () => {
    // A second copy of this mark is how the two sheets would drift apart, and
    // AGENTS.md holds useVenueSheetOpened as the ONE emitter of that moment.
    const hook = read("components/map/useVenueSheetOpened.ts");
    expect(hook).toContain('markConsentAnswerMoment("venue-sheet")');
    expect(read("components/map/VenueInspector.tsx")).not.toContain(
      "markConsentAnswerMoment",
    );
    expect(read("components/map/UnverifiedPubSheet.tsx")).not.toContain(
      "markConsentAnswerMoment",
    );
  });

  it("marks the Pal's ANSWER rather than the reader's ask", () => {
    const chat = read("components/pal/PalChat.tsx");
    expect(chat).toContain('markConsentAnswerMoment("pal-reply")');
    // The ask is still just the ask: a question nobody has replied to is the
    // reader waiting, so the mark may not ride the submit.
    const askIndex = chat.indexOf('trackEvent("concierge_ask")');
    const markIndex = chat.indexOf('markConsentAnswerMoment("pal-reply")');
    expect(askIndex).toBeGreaterThan(-1);
    expect(markIndex).toBeGreaterThan(askIndex);
  });
});

describe("the card waits for that answer", () => {
  const prompt = readFileSync("components/AnalyticsConsentPrompt.tsx", "utf8");

  it("asks the shared rule rather than restating a moment of its own", () => {
    expect(prompt).toContain("hasAnsweredThisSession");
    expect(prompt).toContain('from "@/lib/consentAnswerMoment"');
  });

  it("re-reads when an answer lands, so the wait can end without a reload", () => {
    expect(prompt).toContain("subscribeConsentAnswerMoment");
  });

  it("records the route on EVERY screen, including the ones it never paints on", () => {
    expect(prompt).toContain("noteConsentRouteVisited(pathname)");
    const note = prompt.indexOf("noteConsentRouteVisited(pathname)");
    const ownsGuard = prompt.indexOf("if (pageOwnsConsent) return;");
    expect(note).toBeLessThan(ownsGuard);
  });
});

describe("one consent control on any screen", () => {
  const hub = readFileSync("components/profile/PubmaxxAccountHub.tsx", "utf8");

  it("leaves the signed-out panel with no Allow / No thanks pair of its own", () => {
    const signedOut = hub.slice(
      hub.indexOf("if (viewerSession.signedOut) return ("),
      hub.indexOf("if (!user) return <section"),
    );
    expect(signedOut.length).toBeGreaterThan(0);
    expect(signedOut).not.toContain("analyticsControls");
  });

  it("keeps the settings block where a decision can be REVERSED", () => {
    expect(hub).toContain('<div id="analytics-settings">');
    expect(hub).toContain("{analyticsControls}");
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
