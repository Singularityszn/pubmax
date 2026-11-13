import { describe, expect, it } from "vitest";

import { MATES_BOARD_MAX_MATES, parseMatesBoard, rankMatesBoard, type MatesBoardRow } from "@/lib/matesBoard";
import { readMatesBoard, type MatesBoardDependencies } from "@/lib/matesBoard.server";
import type { PointsStanding } from "@/lib/points";
import type { ProfileRecord } from "@/lib/profileStore";

const VIEWER = { profileId: "p-me", handle: "me", accountId: "a-me" };

const STANDINGS: Record<string, PointsStanding> = {
  me: { status: "ready", total: 120, level: 2 },
  ada: { status: "ready", total: 400, level: 4 },
  bo: { status: "ready", total: 90, level: 2 },
  cy: { status: "ready", total: 50, level: 2 },
};

function profile(handle: string): ProfileRecord {
  return { id: `p-${handle}`, handle, userId: `u-${handle}` } as ProfileRecord;
}

function deps(overrides: Partial<MatesBoardDependencies> = {}): Partial<MatesBoardDependencies> {
  return {
    listMutuals: async () => ["Ada", "bo", "cy", "me", "bo"],
    isMate: async () => true,
    withdrawn: async () => new Set(),
    profile: async (handle) => profile(handle),
    standing: async (owner) => STANDINGS[owner.handle] ?? { status: "ready", total: 0, level: 1 },
    ...overrides,
  };
}

const handles = (rows: readonly MatesBoardRow[]) => rows.map((row) => row.handle);

describe("readMatesBoard", () => {
  it("puts the reader and each mate on the board once, with their own points", async () => {
    const board = await readMatesBoard(VIEWER, deps());
    expect(board).toMatchObject({ status: "ready", capped: false });
    expect(handles(board.rows)).toEqual(["me", "ada", "bo", "cy"]);
    expect(board.rows[0]).toEqual({ handle: "me", self: true, total: 120, level: 2 });
    expect(board.rows.filter((row) => row.self)).toHaveLength(1);
  });

  it("leaves off a mate the live check refuses: a block, a mute or a lapsed follow", async () => {
    const asked: string[] = [];
    const board = await readMatesBoard(
      VIEWER,
      deps({
        isMate: async (_viewer, handle) => handle !== "bo",
        standing: async (owner) => {
          asked.push(owner.handle);
          return STANDINGS[owner.handle]!;
        },
      }),
    );
    expect(handles(board.rows)).toEqual(["me", "ada", "cy"]);
    expect(asked).not.toContain("bo");
  });

  it("leaves off a mate moderation withdrew from public view", async () => {
    const board = await readMatesBoard(VIEWER, deps({ withdrawn: async () => new Set(["cy"]) }));
    expect(handles(board.rows)).toEqual(["me", "ada", "bo"]);
  });

  it("is unavailable, not short, when a mate check cannot answer", async () => {
    await expect(
      readMatesBoard(
        VIEWER,
        deps({
          isMate: async () => {
            throw new Error("Mate relationship unavailable");
          },
        }),
      ),
    ).rejects.toThrow("Mate relationship unavailable");
    await expect(
      readMatesBoard(
        VIEWER,
        deps({
          withdrawn: async () => {
            throw new Error("withdrawal read failed");
          },
        }),
      ),
    ).rejects.toThrow("withdrawal read failed");
  });

  it("shows the reader alone when they have no mates", async () => {
    const board = await readMatesBoard(VIEWER, deps({ listMutuals: async () => [] }));
    expect(board.rows).toEqual([{ handle: "me", self: true, total: 120, level: 2 }]);
  });

  it("says when one person's records did not all load", async () => {
    const board = await readMatesBoard(
      VIEWER,
      deps({
        standing: async (owner) =>
          owner.handle === "ada" ? { ...STANDINGS.ada!, status: "degraded" } : STANDINGS[owner.handle]!,
      }),
    );
    expect(board.status).toBe("degraded");
  });

  it("ranks a bounded number of mates and says the board is capped", async () => {
    const many = Array.from({ length: MATES_BOARD_MAX_MATES + 5 }, (_, i) => `mate${String(i).padStart(3, "0")}`);
    const board = await readMatesBoard(VIEWER, deps({ listMutuals: async () => many }));
    expect(board.rows).toHaveLength(MATES_BOARD_MAX_MATES + 1);
    expect(board.capped).toBe(true);
  });
});

describe("rankMatesBoard", () => {
  const rows: MatesBoardRow[] = [
    { handle: "me", self: true, total: 120, level: 2 },
    { handle: "ada", self: false, total: 400, level: 4 },
    { handle: "bo", self: false, total: 90, level: 2 },
    { handle: "cy", self: false, total: 50, level: 2 },
  ];

  it("ranks all time by total", () => {
    expect(rankMatesBoard(rows).map((row) => [row.handle, row.place, row.points])).toEqual([
      ["ada", 1, 400],
      ["me", 2, 120],
      ["bo", 3, 90],
      ["cy", 4, 50],
    ]);
  });

  it("shares places for equal total points and skips the next place", () => {
    const tied = [...rows, { handle: "di", self: false, total: 120, level: 2 }];
    expect(rankMatesBoard(tied).map((row) => [row.handle, row.place, row.points])).toEqual([
      ["ada", 1, 400],
      ["di", 2, 120],
      ["me", 2, 120],
      ["bo", 4, 90],
      ["cy", 5, 50],
    ]);
  });
});

describe("parseMatesBoard", () => {
  it("reads the route's answer and refuses a row with an invented count", () => {
    const answer = { status: "ready", capped: false, rows: [{ handle: "me", self: true, total: 5, level: 1 }] };
    expect(parseMatesBoard(answer)).toEqual(answer);
    expect(parseMatesBoard({ ...answer, rows: [{ ...answer.rows[0], total: -3 }] })).toBeNull();
    expect(parseMatesBoard({ ...answer, rows: [{ ...answer.rows[0], total: 1.5 }] })).toBeNull();
  });
});
