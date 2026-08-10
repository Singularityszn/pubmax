import { describe, expect, it } from "vitest";

import {
  detectSourcePlatform,
  splitWantedPaste,
  validateWantedCreate,
  wantedVisibilityAllows,
  wantedFulfilledLine,
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

  it("defaults visibility to private and leaves drink interest optional", () => {
    const result = validateWantedCreate({
      ownerActor: "profile:11111111-1111-1111-1111-111111111111",
      venueId: "venue-1ufn31x",
      venueName: "The Dove",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibility).toBe("private");
    expect(result.value.drinkInterest).toBeNull();
  });

  it("accepts a drink interest and mutual or crew visibility", () => {
    const mutual = validateWantedCreate({
      ownerActor: "profile:11111111-1111-1111-1111-111111111111",
      venueId: "venue-1ufn31x",
      venueName: "The Dove",
      drinkInterest: "beer",
      visibility: "mutuals",
    });
    const crew = validateWantedCreate({
      ownerActor: "profile:11111111-1111-1111-1111-111111111111",
      venueId: "venue-1ufn31x",
      venueName: "The Dove",
      visibility: "crew:22222222-2222-4222-8222-222222222222",
    });
    expect(mutual.ok).toBe(true);
    expect(crew.ok).toBe(true);
  });

  it("refuses unknown drink and visibility values", () => {
    expect(validateWantedCreate({
      ownerActor: "profile:11111111-1111-4111-8111-111111111111",
      venueId: "venue-1ufn31x",
      venueName: "The Dove",
      drinkInterest: "moonshine",
    }).ok).toBe(false);
    expect(validateWantedCreate({
      ownerActor: "profile:11111111-1111-4111-8111-111111111111",
      venueId: "venue-1ufn31x",
      venueName: "The Dove",
      visibility: "public",
    }).ok).toBe(false);
  });
});

describe("wanted visibility", () => {
  const wanted = {
    ownerActor: "profile:11111111-1111-4111-8111-111111111111",
    visibility: "private" as const,
  };

  it("keeps private rows owner-only and gates mutuals and crews", () => {
    expect(wantedVisibilityAllows(wanted, "profile:11111111-1111-4111-8111-111111111111", {})).toBe(true);
    expect(wantedVisibilityAllows(wanted, "profile:22222222-2222-4222-8222-222222222222", {})).toBe(false);
    expect(wantedVisibilityAllows(
      { ...wanted, visibility: "mutuals" },
      "profile:22222222-2222-4222-8222-222222222222",
      { mutualOwnerActors: new Set([wanted.ownerActor]) },
    )).toBe(true);
    expect(wantedVisibilityAllows(
      { ...wanted, visibility: "crew:33333333-3333-4333-8333-333333333333" },
      "profile:22222222-2222-4222-8222-222222222222",
      { crewIds: new Set(["33333333-3333-4333-8333-333333333333"]) },
    )).toBe(true);
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
