// The regular night report leaf, its store and its place in the regular-nights
// read (E4). A report is a drinker's dated sighting: it expires, it is "still
// on" once per account, and the read prints it apart from the sourced nights,
// labelled "per a drinker, seen <date>", never as tonight's listing.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import {
  isLiveRegularNightReport,
  regularNightBoardKey,
  REGULAR_NIGHT_REPORT_KINDS,
  REGULAR_NIGHT_REPORT_TTL_MS,
  validateRegularNightReport,
} from "@/lib/regularNightReports";
import {
  __resetRegularNightReports,
  memoryRegularNightReportsStore as store,
} from "@/lib/regularNightReportsStore";
import {
  drinkerRegularNightByline,
  drinkerRegularNightSourceLine,
  parseDrinkerRegularNights,
  parseRegularNights,
  regularNightsForWeekday,
} from "@/lib/regularNights";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const CAROL = "c3333333-3333-4333-8333-333333333333";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-30T18:00:00.000Z");

async function seed(id: string, now = T0, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 2) {
  return store.create(
    {
      id,
      venueId: "venue-crown",
      kind: "quiz",
      weekday,
      startTime: "20:00",
      note: "Teams of six.",
      photoKey: regularNightBoardKey(ALICE, id),
      reporterUserId: ALICE,
    },
    now,
  );
}

beforeEach(() => {
  __resetRegularNightReports();
});

describe("validateRegularNightReport", () => {
  it("takes the closed kinds, a weekday 0 to 6 and an HH:MM start", () => {
    for (const kind of REGULAR_NIGHT_REPORT_KINDS) {
      expect(validateRegularNightReport({ venueId: "v", kind, weekday: "0" }).ok).toBe(true);
    }
    expect(validateRegularNightReport({ venueId: "v", kind: "quiz", weekday: 6, startTime: "23:59" })).toMatchObject({
      ok: true,
      weekday: 6,
      startTime: "23:59",
    });
  });

  it("refuses an unknown kind, a weekday outside the week, a loose time and a long note", () => {
    expect(validateRegularNightReport({ venueId: "v", kind: "bingo", weekday: 1 })).toMatchObject({ ok: false, field: "kind" });
    expect(validateRegularNightReport({ venueId: "v", kind: "quiz", weekday: 7 })).toMatchObject({ ok: false, field: "weekday" });
    expect(validateRegularNightReport({ venueId: "v", kind: "quiz", weekday: "-1" })).toMatchObject({ ok: false, field: "weekday" });
    expect(validateRegularNightReport({ venueId: "v", kind: "quiz", weekday: 1.5 })).toMatchObject({ ok: false, field: "weekday" });
    expect(validateRegularNightReport({ venueId: "v", kind: "quiz", weekday: 1, startTime: "24:00" })).toMatchObject({
      ok: false,
      field: "startTime",
    });
    expect(validateRegularNightReport({ venueId: "v", kind: "quiz", weekday: 1, note: "x".repeat(121) })).toMatchObject({
      ok: false,
      field: "note",
    });
    expect(validateRegularNightReport({ kind: "quiz", weekday: 1 })).toMatchObject({ ok: false, field: "venueId" });
  });

  it("keeps the 0206 CHECKs and the leaf's closed sets the same", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261030210000_0206_regular_night_reports.sql"),
      "utf8",
    );
    expect(sql).toContain(`check (kind in (${REGULAR_NIGHT_REPORT_KINDS.map((kind) => `'${kind}'`).join(", ")}))`);
    expect(sql).toContain("check (length(note) <= 120)");
    expect(sql).toContain("check (weekday between 0 and 6)");
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/to (anon|authenticated)/);
  });
});

describe("regularNightReportsStore (memory)", () => {
  it("round-trips a report and expires it 90 days on", async () => {
    const created = await seed("r1");
    expect(created).toMatchObject({ status: "open", lastSeenAt: new Date(T0).toISOString() });
    expect(Date.parse(created.expiresAt)).toBe(T0 + REGULAR_NIGHT_REPORT_TTL_MS);
    expect(await store.getById("r1")).toEqual(created);
    expect((await store.listForOwner(ALICE)).reports.map((row) => row.id)).toEqual(["r1"]);

    expect((await store.listLive({ weekday: 2 }, T0 + 89 * DAY)).reports).toHaveLength(1);
    expect((await store.listLive({ weekday: 2 }, T0 + 90 * DAY)).reports).toEqual([]);
    expect((await store.listLive({ weekday: 3 }, T0)).reports).toEqual([]);
    expect((await store.listLive({ venueId: "venue-crown" }, T0)).reports).toHaveLength(1);
  });

  it("never reads a hidden row live, and hides a confirmed one", async () => {
    await seed("r1");
    await seed("r2");
    expect(await store.decide("r1", "hidden", "admin", T0)).toBe(true);
    expect(await store.decide("r2", "confirmed", "admin", T0)).toBe(true);
    expect((await store.listLive({ weekday: 2 }, T0)).reports.map((row) => row.id)).toEqual(["r2"]);
    expect(await store.decide("r2", "confirmed", "admin", T0)).toBe(false);
    expect(await store.decide("r2", "hidden", "admin", T0)).toBe(true);
    expect(await store.decide("r2", "hidden", "admin", T0)).toBe(false);
    expect((await store.listLive({ weekday: 2 }, T0)).reports).toEqual([]);
  });

  it("says still on once per account, never for the reporter, and never on an expired row", async () => {
    await seed("r1");
    expect(await store.stillOn("r1", ALICE, T0 + DAY)).toBe("own");
    expect(await store.stillOn("r1", BOB, T0 + DAY)).toBe("extended");
    expect(await store.stillOn("r1", BOB, T0 + 2 * DAY)).toBe("already");
    expect(await store.stillOn("r1", CAROL, T0 + 2 * DAY)).toBe("extended");
    const row = await store.getById("r1");
    expect(Date.parse(row?.expiresAt ?? "")).toBe(T0 + 3 * REGULAR_NIGHT_REPORT_TTL_MS);
    expect(row?.lastSeenAt).toBe(new Date(T0 + 2 * DAY).toISOString());

    await seed("old", T0 - 100 * DAY);
    expect(await store.stillOn("old", BOB, T0)).toBe("not_found");
    expect(await store.stillOn("missing", BOB, T0)).toBe("not_found");
  });

  it("judges a live row by status and expiry alone", () => {
    expect(isLiveRegularNightReport({ status: "open", expiresAt: new Date(T0 + 1).toISOString() }, T0)).toBe(true);
    expect(isLiveRegularNightReport({ status: "confirmed", expiresAt: new Date(T0 + 1).toISOString() }, T0)).toBe(true);
    expect(isLiveRegularNightReport({ status: "hidden", expiresAt: new Date(T0 + 1).toISOString() }, T0)).toBe(false);
    expect(isLiveRegularNightReport({ status: "open", expiresAt: new Date(T0).toISOString() }, T0)).toBe(false);
    expect(isLiveRegularNightReport({ status: "open", expiresAt: "not a date" }, T0)).toBe(false);
  });
});

describe("the regular-nights read with drinker rows", () => {
  const row = (fields: Record<string, unknown>) => ({
    id: "r1",
    venueId: "venue-crown",
    venueName: "The Crown",
    kind: "quiz",
    weekday: 2,
    startTime: "20:00",
    note: "",
    status: "open",
    lastSeenAt: "2026-10-30T18:00:00.000Z",
    expiresAt: new Date(T0 + 30 * DAY).toISOString(),
    handle: "alice",
    ...fields,
  });

  it("drops hidden, expired, undated and unhandled rows, whatever the route sent", () => {
    const parsed = parseDrinkerRegularNights(
      {
        reports: [
          row({}),
          row({ id: "hidden", status: "hidden" }),
          row({ id: "expired", expiresAt: new Date(T0 - 1).toISOString() }),
          row({ id: "undated", lastSeenAt: "" }),
          row({ id: "nobody", handle: null }),
          row({ id: "checked", status: "confirmed", handle: "alice" }),
          row({ id: "bad-kind", kind: "bingo" }),
        ],
      },
      T0,
    );
    expect(parsed.map((night) => night.id)).toEqual(["r1", "checked"]);
    expect(parsed[1]).toMatchObject({ confirmed: true, handle: null });
  });

  it("labels a drinker row by its seen date and its reporter, apart from the sourced nights", () => {
    const [night] = parseDrinkerRegularNights({ reports: [row({})] }, T0);
    expect(night?.own).toBe(false);
    expect(parseDrinkerRegularNights({ reports: [row({ own: true })] }, T0)[0]?.own).toBe(true);
    expect(drinkerRegularNightSourceLine(night!)).toBe("per a drinker, seen 30 October 2026");
    expect(drinkerRegularNightByline(night!)).toBe("@alice");
    expect(drinkerRegularNightByline({ handle: null, confirmed: true })).toBe("checked by a person");

    const sourced = parseRegularNights({});
    const answer = regularNightsForWeekday(sourced, 2, null, [night!]);
    expect(answer.nights).toEqual([]);
    expect(answer.drinker.map((entry) => entry.id)).toEqual(["r1"]);
    expect(regularNightsForWeekday(sourced, 3, null, [night!]).drinker).toEqual([]);
  });
});
