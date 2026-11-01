import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Borough bingo (launch review D8): 33 squares, breadth never volume, the
// owner reads the card, a mutual the count, a stranger nothing, and a share
// link exists only at 11, 22 and 33 for a mark the server counted itself.

vi.mock("@/lib/authedFetch", () => ({ authedFetch: vi.fn() }));

import BoroughBingo from "@/components/profile/BoroughBingo";
import {
  BOROUGH_BINGO_TOTAL,
  boroughBingoCountLine,
  boroughBingoMark,
  boroughBingoView,
  buildBoroughBingo,
} from "@/lib/boroughBingo";
import { LONDON_BOROUGHS } from "@/lib/boroughs";
import {
  boroughBingoSharePath,
  mintBoroughBingoShare,
  verifyBoroughBingoShare,
} from "@/lib/boroughBingoShare.server";
import { mintOwnBoroughBingoShare, type BoroughBingoMintDeps } from "@/lib/boroughBingoMint.server";

const ALL = [...LONDON_BOROUGHS];

describe("the card", () => {
  it("has one square per borough plus the City, 33 in all", () => {
    const card = buildBoroughBingo([]);
    expect(BOROUGH_BINGO_TOTAL).toBe(33);
    expect(card.squares).toHaveLength(33);
    expect(card.squares.map((square) => square.name)).toContain("City of London");
    expect(new Set(card.squares.map((square) => square.slug)).size).toBe(33);
  });

  it("fills a square once however many pints, and ignores anything that is not a borough", () => {
    const card = buildBoroughBingo(["Hackney", "Hackney", "hackney", "Soho", "Manchester", "City of London"]);
    expect(card.filled).toBe(2);
    expect(boroughBingoCountLine(card.filled)).toBe("2 of 33 boroughs");
  });

  it("reaches a mark at 11, 22 and 33 and not between", () => {
    expect(boroughBingoMark(10)).toBeNull();
    expect(boroughBingoMark(11)).toBe(11);
    expect(boroughBingoMark(21)).toBe(11);
    expect(boroughBingoMark(22)).toBe(22);
    expect(boroughBingoMark(33)).toBe(33);
  });

  it("the owner reads the card, a mutual the count, anybody else nothing", () => {
    expect(boroughBingoView({ isOwner: true, isMutual: false })).toBe("card");
    expect(boroughBingoView({ isOwner: false, isMutual: true })).toBe("count");
    expect(boroughBingoView({ isOwner: false, isMutual: false })).toBe("none");
  });
});

describe("the profile component", () => {
  const twelve = ALL.slice(0, 12);
  const render = (isOwner: boolean, isMutual: boolean) =>
    renderToStaticMarkup(createElement(BoroughBingo, { handle: "sam", boroughs: twelve, isOwner, isMutual }));

  it("gives the owner 33 squares, the count line and no share below 11", () => {
    const html = render(true, false);
    expect(html.match(/boroughBingo__square/g)).toHaveLength(33);
    expect(html).toContain("12 of 33 boroughs");
    expect(html).toContain("Share your card");
    expect(renderToStaticMarkup(createElement(BoroughBingo, { handle: "sam", boroughs: ALL.slice(0, 10), isOwner: true, isMutual: false })))
      .not.toContain("Share your card");
  });

  it("gives a mutual the count and no borough, and a stranger nothing", () => {
    const mutual = render(false, true);
    expect(mutual).toContain("12 of 33 boroughs");
    expect(mutual).not.toContain("boroughBingo__square");
    for (const name of twelve) expect(mutual).not.toContain(name);
    expect(render(false, false)).toBe("");
  });

  it("says nothing competitive", () => {
    const source = readFileSync("components/profile/BoroughBingo.tsx", "utf8") + readFileSync("lib/boroughBingo.ts", "utf8");
    const copy = [...source.matchAll(/"([^"]*)"|>([^<>{}]+)</g)].map((match) => match[1] ?? match[2] ?? "").join(" ");
    expect(copy).not.toMatch(/leaderboard|streak|rank|beat|top \d|referral|level/i);
  });
});

describe("the share link", () => {
  it("round-trips a mark for the handle it names and refuses anything else", () => {
    const token = mintBoroughBingoShare("Sam", 22, 1_000);
    expect(verifyBoroughBingoShare(token, "sam")).toEqual({ handle: "sam", mark: 22, issuedAt: 1_000 });
    expect(verifyBoroughBingoShare(token, "alex")).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, h: "sam", m: 33, iat: 1 }), "utf8").toString("base64url");
    expect(verifyBoroughBingoShare(`${forged}.${sig}`, "sam")).toBeNull();
    expect(() => mintBoroughBingoShare("sam", 12 as never)).toThrow();
    expect(boroughBingoSharePath("sam", "t")).toBe("/u/sam/boroughs/t");
  });

  function deps(count: number, caller: string | null = "user-sam"): BoroughBingoMintDeps {
    const ids = ALL.slice(0, count).flatMap((name, index) => [`v-${index}`, `v-${index}-again`]);
    return {
      verifyCaller: async () => caller,
      profile: async (handle) => (handle === "sam" ? { userId: "user-sam", tombstoned: false } : null),
      venueIds: async () => ids,
      // Two pubs in each borough: the second fills nothing more.
      borough: async (id) => ALL[Number(id.split("-")[1])] ?? null,
      now: () => 5,
    };
  }
  const request = new Request("http://localhost/api/profiles/sam/borough-bingo");

  it("signs the highest mark the server counted, for the owner only", async () => {
    const minted = await mintOwnBoroughBingoShare(request, "sam", deps(23));
    expect(minted).toMatchObject({ ok: true, mark: 22 });
    if (!minted.ok) throw new Error("expected a link");
    const token = decodeURIComponent(minted.path.split("/").at(-1)!);
    expect(verifyBoroughBingoShare(token, "sam")?.mark).toBe(22);

    expect(await mintOwnBoroughBingoShare(request, "sam", deps(23, "user-alex"))).toMatchObject({ ok: false, status: 403 });
    expect(await mintOwnBoroughBingoShare(request, "sam", deps(23, null))).toMatchObject({ ok: false, status: 403 });
    expect(await mintOwnBoroughBingoShare(request, "sam", deps(10))).toMatchObject({ ok: false, status: 409 });
    expect(await mintOwnBoroughBingoShare(request, "nobody", deps(33))).toMatchObject({ ok: false, status: 404 });
  });
});
