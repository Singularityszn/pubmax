import { afterEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// A table that applies the filters the reader asks for, so the test reads
// what a stranger would be told, not which calls were made.
const tables: Record<string, Row[]> = {};
let beforeRead: ((table: string) => Promise<void>) | undefined;
let afterRead: ((table: string) => void) | undefined;

function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return chain;
    },
    gt: (column: string, value: string) => {
      filters.push((row) => typeof row[column] === "string" && (row[column] as string) > value);
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return chain;
    },
    then: async (resolve: (value: { data: Row[]; error: null }) => unknown) => {
      if (beforeRead) await beforeRead(table);
      const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      afterRead?.(table);
      return resolve({ data: rows, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  requireDynamicSupabaseAdmin: () => ({ from: query }),
}));

import { stillTrueCountReader } from "@/lib/openCrawlShareCard.server";

const CREW = "50000000-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 10, 13, 12);

afterEach(() => {
  vi.useRealTimers();
  beforeRead = undefined;
  afterRead = undefined;
  for (const table of Object.keys(tables)) delete tables[table];
});

describe("one-pub night headcount", () => {
  it("counts a live request and a guest seat, never an expired request or the host", async () => {
    vi.useFakeTimers({ now: NOW });
    tables.social_crew_join_requests = [
      { crew_id: CREW, requester_account_id: "live", state: "pending", expires_at: "2026-11-14T12:00:00.000Z" },
      // Expiry is recorded lazily, so this row still reads pending.
      { crew_id: CREW, requester_account_id: "stale", state: "pending", expires_at: "2026-11-12T12:00:00.000Z" },
    ];
    tables.social_crew_members = [
      { crew_id: CREW, social_account_id: "host", plan_member_id: "seat-host", role: "owner", state: "active" },
      { crew_id: CREW, social_account_id: "guest", plan_member_id: "seat-guest", role: "member", state: "active" },
    ];
    tables.plan_crew_members = [
      { id: "seat-host", status: "here" },
      { id: "seat-guest", status: "going" },
    ];

    expect(await stillTrueCountReader.read(CREW)).toEqual({ saidYes: 2, markedHere: 1 });
  });

  it("counts an attendee once when the host accepts between count reads", async () => {
    vi.useFakeTimers({ now: NOW });
    tables.social_crew_join_requests = [
      { crew_id: CREW, requester_account_id: "guest", state: "pending", expires_at: "2026-11-14T12:00:00.000Z" },
    ];
    tables.social_crew_members = [];
    tables.plan_crew_members = [{ id: "seat-guest", status: "going" }];
    beforeRead = async (table) => {
      if (table === "social_crew_join_requests") await Promise.resolve();
    };
    afterRead = (table) => {
      if (table !== "social_crew_join_requests" && table !== "social_crew_members") return;
      tables.social_crew_join_requests = [
        { ...tables.social_crew_join_requests[0], state: "accepted" },
      ];
      tables.social_crew_members = [
        { crew_id: CREW, social_account_id: "guest", plan_member_id: "seat-guest", role: "member", state: "active" },
      ];
      afterRead = undefined;
    };

    expect(await stillTrueCountReader.read(CREW)).toEqual({ saidYes: 1, markedHere: 0 });
  });
});
