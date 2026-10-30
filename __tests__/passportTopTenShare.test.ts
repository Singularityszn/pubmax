// The top-ten share link: only a list the server signed for this handle opens
// a page, and the page shows exactly the ten it signed, in order.

import { describe, expect, it } from "vitest";

import { mintTopTenShare, topTenSharePath, verifyTopTenShare } from "@/lib/passportTopTenShare.server";

const TEN = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

describe("top-ten share token", () => {
  it("round-trips ten ids in order for the handle it names", () => {
    const token = mintTopTenShare("Sam", TEN, 1_000);
    expect(verifyTopTenShare(token, "sam")).toEqual({ handle: "sam", venueIds: TEN, issuedAt: 1_000 });
  });

  it("refuses another handle, a changed list and junk", () => {
    const token = mintTopTenShare("sam", TEN);
    expect(verifyTopTenShare(token, "alex")).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, h: "sam", ids: ["z"], iat: 1 }), "utf8").toString("base64url");
    expect(verifyTopTenShare(`${forged}.${sig}`, "sam")).toBeNull();
    expect(verifyTopTenShare(`${body}.`, "sam")).toBeNull();
    expect(verifyTopTenShare("nonsense", "sam")).toBeNull();
    expect(verifyTopTenShare(undefined, "sam")).toBeNull();
  });

  it("will not sign more than ten or none", () => {
    expect(() => mintTopTenShare("sam", [...TEN, "k"])).toThrow();
    expect(() => mintTopTenShare("sam", [])).toThrow();
  });

  it("puts the token in the path, where the card can read it", () => {
    expect(topTenSharePath("sam", "abc.def")).toBe("/u/sam/top-ten/abc.def");
  });
});
