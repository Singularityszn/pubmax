// THE LIMITED CARD IS AN ALLOW LIST, and this suite is what holds it to that.
//
// The projection is pure, so every case here is a value in and a value out. The
// load-bearing test is the last one: a field added to `PublicProfile` tomorrow
// must be withheld from a private account by DEFAULT, because a deny list is
// how the next public field leaks.

import { describe, expect, it } from "vitest";

import type { PublicProfile } from "@/lib/profiles";
import {
  fullProfileProjection,
  isLimitedProfileProjection,
  LIMITED_PROFILE_CARD_FIELDS,
  limitedProfileCard,
  limitedProfileProjection,
  PROFILE_FIELDS_WITHHELD_WHEN_PRIVATE,
  profileProjectionKind,
  projectionCarriesSocialLinks,
  PROFILE_VIEWER_RELATIONS,
} from "@/lib/profileVisibility";

/** Every field filled with a value distinctive enough to find in a body. */
function filledProfile(): PublicProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    handle: "night_person",
    displayName: "Night Person",
    avatarUrl: "/api/avatar/11111111-1111-4111-8111-111111111111/gen-1",
    coverUrl: "/api/cover/11111111-1111-4111-8111-111111111111/gen-1",
    coverUrls: ["/api/cover/11111111-1111-4111-8111-111111111111/gen-1"],
    homeCity: "Camden",
    bio: "Withheld-bio-sentence",
    favouriteDrink: "Withheld-drink",
    interests: "Withheld-interests",
    workplace: "Withheld-workplace",
    foundingMemberNumber: 7,
    visibility: "private",
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-09-08T09:00:00.000Z",
  };
}

describe("profileProjectionKind", () => {
  it("answers the full card to everybody on a public account", () => {
    for (const relation of PROFILE_VIEWER_RELATIONS) {
      expect(profileProjectionKind({ visibility: "public", relation })).toBe("full");
    }
  });

  it("answers the full card to a private account's owner and to a mate", () => {
    expect(profileProjectionKind({ visibility: "private", relation: "owner" })).toBe("full");
    expect(profileProjectionKind({ visibility: "private", relation: "mate" })).toBe("full");
  });

  it("answers the limited card to everybody else on a private account", () => {
    expect(profileProjectionKind({ visibility: "private", relation: "stranger" })).toBe(
      "limited",
    );
  });

  it("holds three relations and no pending follow request among them", () => {
    expect([...PROFILE_VIEWER_RELATIONS]).toEqual(["owner", "mate", "stranger"]);
  });
});

describe("the limited card", () => {
  it("carries the handle, the name, the face and the founding mark", () => {
    const card = limitedProfileCard(filledProfile());
    expect(card.handle).toBe("night_person");
    expect(card.displayName).toBe("Night Person");
    expect(card.avatarUrl).toBeDefined();
    expect(card.foundingMemberNumber).toBe(7);
    expect(card.visibility).toBe("private");
  });

  it("withholds every owner-authored field, asserted over the whole body", () => {
    const raw = JSON.stringify(limitedProfileProjection(filledProfile()));
    for (const leak of [
      "Withheld-bio-sentence",
      "Withheld-drink",
      "Withheld-interests",
      "Withheld-workplace",
      "Camden",
      "/api/cover/",
    ]) {
      expect(raw).not.toContain(leak);
    }
    for (const key of PROFILE_FIELDS_WITHHELD_WHEN_PRIVATE) {
      expect(raw).not.toContain(`"${key}"`);
    }
  });

  it("keeps the two lists disjoint, so no field is both carried and withheld", () => {
    const carried = new Set<string>(LIMITED_PROFILE_CARD_FIELDS);
    for (const key of PROFILE_FIELDS_WITHHELD_WHEN_PRIVATE) {
      expect(carried.has(key)).toBe(false);
    }
  });

  // The whole reason the code copies an ALLOW list rather than deleting a DENY
  // list: a field nobody has thought about yet is withheld already.
  it("withholds a field added to PublicProfile that nobody put on the list", () => {
    const future = {
      ...filledProfile(),
      phoneNumber: "07700-900000",
    } as unknown as PublicProfile;
    const raw = JSON.stringify(limitedProfileCard(future));
    expect(raw).not.toContain("07700-900000");
    expect(raw).not.toContain("phoneNumber");
  });

  it("carries exactly the keys the allow list names", () => {
    const card = limitedProfileCard(filledProfile());
    for (const key of Object.keys(card)) {
      expect(LIMITED_PROFILE_CARD_FIELDS as readonly string[]).toContain(key);
    }
  });
});

describe("the projection discriminant", () => {
  it("reads a limited body and nothing else", () => {
    expect(isLimitedProfileProjection(limitedProfileProjection(filledProfile()))).toBe(true);
    expect(isLimitedProfileProjection(fullProfileProjection(filledProfile()))).toBe(false);
    expect(isLimitedProfileProjection({ projection: "full" })).toBe(false);
    expect(isLimitedProfileProjection(null)).toBe(false);
    expect(isLimitedProfileProjection("limited")).toBe(false);
  });

  it("keeps a null full projection, because a missing row is not a private one", () => {
    const projection = fullProfileProjection(null);
    expect(projection.projection).toBe("full");
    expect(projection.profile).toBeNull();
  });

  it("takes the linked socials off the limited lane", () => {
    expect(projectionCarriesSocialLinks("full")).toBe(true);
    expect(projectionCarriesSocialLinks("limited")).toBe(false);
  });
});
