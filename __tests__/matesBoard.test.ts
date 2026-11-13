// The mates' board (lib/matesBoard.server.ts and lib/matesBoard.ts): who is on
// it, what each row says, and how a window ranks it. Every store is a fake.

import { describe, expect, it } from "vitest";

import { MATES_BOARD_MAX_MATES, parseMatesBoard, rankMatesBoard, type MatesBoardRow } from "@/lib/matesBoard";
import { readMatesBoard, type MatesBoardDependencies } from "@/lib/matesBoard.server";
import type { PointsStanding } from "@/lib/points";
import type { ProfileRecord } from "@/lib/profileStore";

const VIEWER = { profileId: "p-me", handle: "me", accountId: "a-me" };
const NOW = new Date("2026-11-13T12:00:00Z");

const STANDINGS: Record<string, PointsStanding> = {
  me: { status: "ready", total: 120, level: 2, monthTotal: 30 },
  ada: { status: "ready", total: 400, level: 4, monthTotal: 10 },
  bo: { status: "ready", total: 90, level: 2, monthTotal: 30 },
  cy: { status: "ready", total: 50, level: 2, monthTotal: 0 },
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
    standing: async (owner, monthStart) => {
      expect(monthStart).toBe("2026-11-01");
      return STANDINGS[owner.handle] ?? { status: "ready", total: 0, level: 1, monthTotal: 0 };
    },
    ...overrides,
  };
}

const handles = (rows: readonly MatesBoardRow[]) => rows.map((row) => row.handle);

describe("readMatesBoard", () => {
  it("puts the reader and each mate on the board once, with their own points", async () => {
    const board = await readMatesBoard(VIEWER, NOW, deps());
    expect(board).toMatchObject({ monthStart: "2026-11-01", status: "ready", capped: false });
    expect(handles(board.rows)).toEqual(["me", "ada", "bo", "cy"]);
    expect(board.rows[0]).toEqual({ handle: "me", self: true, total: 120, level: 2, monthTotal: 30 });
    expect(board.rows.filter((row) => row.self)).toHaveLength(1);
  });

  it("leaves off a mate the live check refuses: a block, a mute or a lapsed follow", async () => {
    const asked: string[] = [];
    const board = await readMatesBoard(
      VIEWER,
      NOW,
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
    const board = await readMatesBoard(VIEWER, NOW, deps({ withdrawn: async () => new Set(["cy"]) }));
    expect(handles(board.rows)).toEqual(["me", "ada", "bo"]);
  });

  it("is unavailable, not short, when a mate check cannot answer", async () => {
    await expect(
      readMatesBoard(
        VIEWER,
        NOW,
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
        NOW,
        deps({
          withdrawn: async () => {
            throw new Error("withdrawal read failed");
          },
        }),
      ),
    ).rejects.toThrow("withdrawal read failed");
  });

  it("shows the reader alone when they have no mates", async () => {
    const board = await readMatesBoard(VIEWER, NOW, deps({ listMutuals: async () => [] }));
    expect(board.rows).toEqual([{ handle: "me", self: true, total: 120, level: 2, monthTotal: 30 }]);
  });

  it("says when one person's records did not all load", async () => {
    const board = await readMatesBoard(
      VIEWER,
      NOW,
      deps({
        standing: async (owner) =>
          owner.handle === "ada" ? { ...STANDINGS.ada!, status: "degraded" } : STANDINGS[owner.handle]!,
      }),
    );
    expect(board.status).toBe("degraded");
  });

  it("ranks a bounded number of mates and says the board is capped", async () => {
    const many = Array.from({ length: MATES_BOARD_MAX_MATES + 5 }, (_, i) => `mate${String(i).padStart(3, "0")}`);
    const board = await readMatesBoard(VIEWER, NOW, deps({ listMutuals: async () => many }));
    expect(board.rows).toHaveLength(MATES_BOARD_MAX_MATES + 1);
    expect(board.capped).toBe(true);
  });
});

describe("rankMatesBoard", () => {
  const rows: MatesBoardRow[] = [
    { handle: "me", self: true, total: 120, level: 2, monthTotal: 30 },
    { handle: "ada", self: false, total: 400, level: 4, monthTotal: 10 },
    { handle: "bo", self: false, total: 90, level: 2, monthTotal: 30 },
    { handle: "cy", self: false, total: 50, level: 2, monthTotal: 0 },
  ];

  it("ranks all time by total", () => {
    expect(rankMatesBoard(rows, "all").map((row) => [row.handle, row.place, row.points])).toEqual([
      ["ada", 1, 400],
      ["me", 2, 120],
      ["bo", 3, 90],
      ["cy", 4, 50],
    ]);
  });

  it("ranks this month by month points, and equal points share a place", () => {
    expect(rankMatesBoard(rows, "month").map((row) => [row.handle, row.place, row.points])).toEqual([
      ["bo", 1, 30],
      ["me", 1, 30],
      ["ada", 3, 10],
      ["cy", 4, 0],
    ]);
  });
});

describe("parseMatesBoard", () => {
  it("reads the route's answer and refuses a row with an invented count", () => {
    const answer = { monthStart: "2026-11-01", status: "ready", capped: false, rows: [{ handle: "me", self: true, total: 5, level: 1, monthTotal: 5 }] };
    expect(parseMatesBoard(answer)).toEqual(answer);
    expect(parseMatesBoard({ ...answer, rows: [{ ...answer.rows[0], total: -3 }] })).toBeNull();
    expect(parseMatesBoard({ ...answer, rows: [{ ...answer.rows[0], monthTotal: 1.5 }] })).toBeNull();
    expect(parseMatesBoard({ ...answer, monthStart: "2026-11-13" })).toBeNull();
  });
});
