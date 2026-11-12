import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  failAfterPage: false,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({
      from: (table: string) => ({
        select: (_columns: string, options?: { count?: string; head?: boolean }) => {
          const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
          let limit = 200;
          let after = false;
          const query = {
            eq(key: string, value: unknown) {
              predicates.push((row) => row[key] === value);
              return query;
            },
            in(key: string, values: unknown[]) {
              predicates.push((row) => values.includes(row[key]));
              return query;
            },
            gt(key: string, value: string | number) {
              after = true;
              predicates.push((row) => typeof value === "number"
                ? Number(row[key]) > value : String(row[key]) > value);
              return query;
            },
            order() { return query; },
            limit(value: number) { limit = Math.min(value, 200); return query; },
            then(resolve: (result: unknown) => unknown) {
              if (after && database.failAfterPage) {
                return Promise.resolve({ data: null, error: { message: "page unavailable" }, count: null }).then(resolve);
              }
              const all = (database.tables[table] ?? [])
                .filter((row) => predicates.every((predicate) => predicate(row)))
                .sort((a, b) => typeof a.id === "number"
                  ? Number(a.id) - Number(b.id) : String(a.id).localeCompare(String(b.id)));
              return Promise.resolve({
                data: options?.head ? null : all.slice(0, limit),
                error: null,
                count: options?.count === "exact" ? all.length : null,
              }).then(resolve);
            },
          };
          return query;
        },
      }),
    }),
  };
});

import { diaryStore } from "@/lib/diaryStore";
import { defaultPassportDeps } from "@/lib/profilePassport.server";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";

const id = (value: number) => String(value).padStart(8, "0");

afterEach(() => {
  database.tables = {};
  database.failAfterPage = false;
});

describe("complete server owner reads for points", () => {
  it("includes owned and joined completed plans beyond 200 without duplicating shared plans", async () => {
    database.tables.plan_crew_members = Array.from({ length: 201 }, (_, i) => ({
      id: id(i), user_id: "owner", plan_id: `joined-${id(i)}`,
    }));
    database.tables.plans = [
      { id: "joined-00000000", owner_user_id: "owner" },
      { id: "owned", owner_user_id: "owner" },
      { id: "pending", owner_user_id: "owner" },
      { id: "other", owner_user_id: "other" },
    ];
    database.tables.plan_completions = [
      ...Array.from({ length: 201 }, (_, i) => ({ id: id(i), plan_id: `joined-${id(i)}`, completed_at: "2026-11-01T12:00:00Z" })),
      { id: "owned", plan_id: "owned", completed_at: "2026-11-01T12:00:00Z" },
      { id: "other", plan_id: "other", completed_at: "2026-11-01T12:00:00Z" },
    ];
    database.tables.plan_stops = database.tables.plan_completions.flatMap((plan, i) =>
      Array.from({ length: 3 }, (_, j) => ({
        id: i * 3 + j, plan_id: plan.plan_id, venue_id: `pub-${i}-${j}`, venue_name: "A pub",
      })),
    );
    const sightings = await defaultPassportDeps().plans("owner");
    expect(sightings).toHaveLength(606);
    expect(new Set(sightings.map((row) => row.venueId)).size).toBe(606);
    expect(sightings.some((row) => row.venueId === "pub-201-0")).toBe(true);
    expect(sightings.some((row) => row.venueId === "pub-202-0")).toBe(false);
  });

  it("returns every diary entry and refuses a partial diary as ready", async () => {
    database.tables.diary_entries = Array.from({ length: 1001 }, (_, i) => ({
      id: id(i), owner_user_id: "owner", venue_id: `pub-${i}`, venue_name: "A pub",
      visited_on: "2026-11-01", created_at: "2026-11-01T12:00:00Z", rating: null,
      review: "", usual_drink: "", with_names: "", visibility: "private",
    }));
    const result = await diaryStore().listForOwner("owner");
    expect(result.status).toBe("ready");
    expect(result.entries).toHaveLength(1001);
    database.failAfterPage = true;
    expect(await diaryStore().listForOwner("owner")).toEqual({ status: "degraded", entries: [] });
  });

  it("counts accepted and resolved rows before provider display limits", async () => {
    database.tables.venue_submissions = Array.from({ length: 301 }, (_, i) => ({
      id: id(i), owner_user_id: i === 300 ? "other" : "owner", status: i < 250 ? "accepted" : "pending",
    }));
    database.tables.venue_corrections = Array.from({ length: 401 }, (_, i) => ({
      id: id(i), owner_user_id: i === 400 ? "other" : "owner", status: i < 350 ? "resolved" : "open",
    }));
    expect(await venueSubmissionStore().countAcceptedForOwner("owner")).toBe(250);
    expect(await venueCorrectionsStore().countResolvedForOwner("owner")).toBe(350);
  });
});
