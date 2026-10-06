import { describe, expect, it } from "vitest";

import {
  detectSourcePlatform,
  isWantedPromotable,
  splitWantedPaste,
  validateWantedCreate,
  wantedFulfilledLine,
  wantedLinkHost,
  wantedLinkHref,
  wantedPendingLabel,
} from "@/lib/wanted";

describe("wanted paste split", () => {
  it("keeps a name query and a provenance URL without fetching", () => {
    const split = splitWantedPaste(
      "The Churchill Arms https://www.instagram.com/reel/abc123/",
    );
    expect(split.query).toBe("The Churchill Arms");
    expect(split.sourceUrl).toContain("instagram.com");
    expect(split.sourcePlatform).toBe("instagram");
  });

  it("treats a bare Instagram URL as empty query (pending path)", () => {
    const split = splitWantedPaste("https://www.instagram.com/p/xyz/");
    expect(split.query).toBe("");
    expect(split.sourceUrl).toContain("instagram.com");
    expect(split.sourcePlatform).toBe("instagram");
  });

  it("refuses credential phishing shapes in the URL", () => {
    const split = splitWantedPaste("https://user:pass@evil.example/phish");
    expect(split.sourceUrl).toBe("");
  });

  it("labels TikTok and YouTube hosts", () => {
    expect(detectSourcePlatform("https://www.tiktok.com/@x/video/1")).toBe("tiktok");
    expect(detectSourcePlatform("https://youtu.be/abc")).toBe("youtube");
    expect(detectSourcePlatform("https://example.com/x")).toBe("other");
  });
});

describe("wanted create validation", () => {
  it("requires a profile actor", () => {
    const result = validateWantedCreate({
      ownerActor: "handle:sam",
      venueId: "venue-1",
      venueName: "The Dove",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a confirmed curated venue", () => {
    const result = validateWantedCreate({
      ownerActor: "profile:11111111-1111-1111-1111-111111111111",
      venueId: "venue-1ufn31x",
      venueName: "The Dove",
      sourceUrl: "https://www.instagram.com/reel/abc/",
      note: "Mate swore by it",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.venueKind).toBe("curated");
    expect(result.value.sourcePlatform).toBe("instagram");
  });

  it("accepts a pending paste with raw text only", () => {
    const result = validateWantedCreate({
      ownerActor: "profile:11111111-1111-1111-1111-111111111111",
      venueKind: "pending",
      rawPaste: "that riverside pub from the reel",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.venueKind).toBe("pending");
    expect(result.value.venueId).toBe("");
  });

  it("marks uk-base ids honestly", () => {
    const result = validateWantedCreate({
      ownerActor: "profile:11111111-1111-1111-1111-111111111111",
      venueId: "venue-uk-n251829660",
      venueName: "A village pub",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.venueKind).toBe("uk_base");
  });
});

describe("wanted copy", () => {
  it("celebrates fulfilment in one plain line", () => {
    expect(wantedFulfilledLine("The Dove")).toBe("Wanted, done: you made it to The Dove.");
  });

  it("labels pending Wanteds honestly", () => {
    expect(wantedPendingLabel("mystery riverside")).toContain("Still matching");
  });
});

describe("Wanted public-list eligibility", () => {
  const resolved = {
    id: "wanted-1",
    ownerActor: "profile:11111111-1111-1111-1111-111111111111",
    venueKind: "curated" as const,
    venueId: "venue-1",
    venueName: "The Dove",
    sourceUrl: "",
    sourcePlatform: "none" as const,
    note: "",
    rawPaste: "The Dove",
    status: "open" as const,
    createdAt: "2026-08-24T09:00:00.000Z",
    fulfilledAt: null,
    promotedListType: null,
    promotedAt: null,
  };

  it("allows only open resolved Venue Dataset Wanteds", () => {
    expect(isWantedPromotable(resolved)).toBe(true);
    expect(isWantedPromotable({ ...resolved, venueKind: "pending", venueId: "" }))
      .toBe(false);
    expect(isWantedPromotable({ ...resolved, venueKind: "uk_base" })).toBe(false);
    expect(isWantedPromotable({ ...resolved, status: "fulfilled" })).toBe(false);
    expect(isWantedPromotable({ ...resolved, promotedListType: "Want to Visit" }))
      .toBe(false);
  });
});

describe("wantedLinkHref", () => {
  it("opens a plain http or https link the owner saved", () => {
    expect(wantedLinkHref("https://www.instagram.com/reel/abc123/")).toBe(
      "https://www.instagram.com/reel/abc123/",
    );
    expect(wantedLinkHref("http://example.com/pub")).toBe("http://example.com/pub");
    expect(wantedLinkHost("https://www.instagram.com/reel/abc123/")).toBe("instagram.com");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/pub",
    "https://user:pass@evil.example/phish",
    "not a url",
    "",
    "   ",
  ])("does not open %j", (value) => {
    expect(wantedLinkHref(value)).toBeNull();
    expect(wantedLinkHost(value)).toBe("");
  });

  it("does not open a value that is not text", () => {
    expect(wantedLinkHref(undefined)).toBeNull();
    expect(wantedLinkHref(42)).toBeNull();
  });
});
