import { describe, expect, it } from "vitest";

import { followListHandle, parseFollowListEntry } from "@/lib/followList";

describe("followList entry parsing", () => {
  it("accepts a legacy string row", () => {
    expect(parseFollowListEntry("Sam")).toEqual({ handle: "sam" });
    expect(followListHandle("Sam")).toBe("sam");
  });

  it("accepts an enriched object row", () => {
    expect(
      parseFollowListEntry({
        handle: "Sam",
        displayName: "Sam I Am",
        avatarUrl: "/api/avatar/p1/g1",
      }),
    ).toEqual({
      handle: "sam",
      displayName: "Sam I Am",
      avatarUrl: "/api/avatar/p1/g1",
    });
  });

  it("refuses junk rows", () => {
    expect(parseFollowListEntry(null)).toBeNull();
    expect(parseFollowListEntry({})).toBeNull();
    expect(followListHandle({ handle: "   " })).toBe("");
  });
});
