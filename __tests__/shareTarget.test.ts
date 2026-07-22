import { describe, expect, it } from "vitest";

import { extractFirstHttpUrl, resolveShareTarget } from "@/lib/shareTarget";

describe("share target", () => {
  it("extracts the first URL from shared text and strips sentence punctuation", () => {
    expect(extractFirstHttpUrl("Meet here https://example.com/pub). Then move.")).toBe("https://example.com/pub");
  });

  it("opens internal PUBMAXX links without creating an external redirect", () => {
    const decision = resolveShareTarget({
      title: "Our crawl",
      url: "https://pubmaxxing.com/plan/abc123?join=1",
    });

    expect(decision.kind).toBe("internal");
    expect(decision.primaryHref).toBe("/plan/abc123?join=1");
    expect(decision.sourceUrl).toBe("https://pubmaxxing.com/plan/abc123?join=1");
  });

  it("turns a shared pub title into a map search", () => {
    const decision = resolveShareTarget({
      title: "The French House - Google Maps",
      url: "https://maps.google.com/?cid=123",
    });

    expect(decision.kind).toBe("map-query");
    expect(decision.query).toBe("The French House");
    expect(decision.primaryHref).toBe("/map?q=The%20French%20House&intent=share");
  });

  it("falls back to shared text when no title is present", () => {
    const decision = resolveShareTarget({
      text: "Check this out: Ye Olde Cheshire Cheese https://example.com/listing",
    });

    expect(decision.kind).toBe("map-query");
    expect(decision.query).toBe("Ye Olde Cheshire Cheese");
  });

  it("keeps an empty share useful", () => {
    const decision = resolveShareTarget({});

    expect(decision.kind).toBe("empty");
    expect(decision.primaryHref).toBe("/map");
    expect(decision.query).toBeNull();
  });
});
