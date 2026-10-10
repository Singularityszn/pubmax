import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  missingVisibility: false,
  failLaterPage: false,
}));

// Local query double models filtering before the server's page limit.
// It stores no provider credentials and never opens a network connection.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  const admin = {
    from: () => ({
      select: () => {
        const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
        let sortBy = "id";
        let ascending = true;
        let cap = Infinity;
        let hasVisibility = false;
        let laterPage = false;
        const query = {
          eq(key: string, value: unknown) {
            predicates.push((row) => row[key] === value);
            return query;
          },
          neq(key: string, value: unknown) {
            hasVisibility = key === "visibility";
            predicates.push((row) => row[key] !== value);
            return query;
          },
          in(key: string, values: unknown[]) {
            predicates.push((row) => values.includes(row[key]));
            return query;
          },
          gt(key: string, value: string) {
            laterPage = true;
            predicates.push((row) => String(row[key]) > value);
            return query;
          },
          order(key: string, options: { ascending: boolean }) {
            sortBy = key;
            ascending = options.ascending;
            return query;
          },
          limit(value: number) { cap = value; return query; },
          then(resolve: (value: unknown) => unknown) {
            if (database.missingVisibility && hasVisibility) {
              return Promise.resolve({ data: null, error: { code: "42703", message: "column visibility does not exist" } }).then(resolve);
            }
            if (database.failLaterPage && laterPage) {
              return Promise.resolve({ data: null, error: { message: "Disposable second-page failure" } }).then(resolve);
            }
            const rows = database.rows.filter((row) => predicates.every((predicate) => predicate(row)))
              .sort((a, b) => String(a[sortBy]).localeCompare(String(b[sortBy])) * (ascending ? 1 : -1))
              .slice(0, cap);
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
        };
        return query;
      },
    }),
  };
  return { ...actual, requireSupabaseAdmin: () => admin };
});

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetPintDrops, addPintDrop, type PintDrop, type ViewerContext } from "@/lib/pintDrops";
import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";
import { buildPassport } from "@/lib/passport";
import { buildPassportShareText } from "@/lib/shareArtifacts";
import { getVenueIndex } from "@/lib/venueIndex";

const author = "geography_author";
function seed(index: number, overrides: Partial<PintDrop> = {}): PintDrop {
  const drop: PintDrop = {
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    handle: author, venueId: "venue-eltcmh", drink: "", priceGbp: null,
    passedDownNote: "Disposable local geography fixture", era: "", provenance: "anecdote",
    createdAt: "2026-01-01T00:00:00.000Z", status: "visible", visibility: "public",
    ...overrides,
  };
  addPintDrop(drop);
  database.rows.push({
    id: drop.id, handle: drop.handle, venue_id: drop.venueId,
    status: drop.status, visibility: drop.visibility, created_at: drop.createdAt,
    author_retired_at: drop.authorRetiredAt,
  });
  return drop;
}

afterEach(() => {
  database.rows = [];
  database.failLaterPage = false;
  database.missingVisibility = false;
  __resetPintDrops();
  __resetMemoryProfileWithdrawals();
  __resetMemoryProfiles();
});

for (const [name, store] of [["memory", memoryPintDropStore], ["Supabase", supabasePintDropStore]] as const) {
  describe(`${name} complete attributed author geography`, () => {
    it("keeps an older area beyond 500 author rows with equal timestamps", async () => {
      for (let i = 0; i < 500; i++) seed(i, { venueId: "venue-1pfnt71" });
      seed(500);
      expect(await store.listVisibleAuthorVenueIds(author)).toEqual(["venue-1pfnt71", "venue-eltcmh"]);
      expect(await store.listVisible(undefined, undefined, author)).toHaveLength(500);
    });

    it("does not let another author's crowd consume the author-scoped timeline", async () => {
      seed(0);
      seed(1, { venueId: "venue-wrpmzq" });
      for (let i = 2; i < 603; i++) seed(i, {
        handle: "unrelated_author", venueId: "venue-1pfnt71", createdAt: "2026-02-01T00:00:00.000Z",
      });
      expect(await store.listVisibleAuthorVenueIds(author)).toEqual(["venue-eltcmh", "venue-wrpmzq"]);
      expect((await store.listVisible(undefined, undefined, author)).map((drop) => drop.handle)).toEqual([author, author]);
    });

    it("continues past a full page that is invisible to this viewer", async () => {
      for (let i = 0; i < 500; i++) seed(i, {
        visibility: "friends", venueId: "venue-wrpmzq", createdAt: "2026-02-01T00:00:00.000Z",
      });
      seed(500);
      const venueIds = await store.listVisibleAuthorVenueIds(author);
      expect(venueIds).toEqual(["venue-eltcmh"]);
      const index = await getVenueIndex();
      const areas = venueIds.map((id) => index.get(id)!.borough);
      expect(areas).toEqual(["City of London"]);
      const timeline = await store.listVisible(undefined, undefined, author);
      expect(timeline).toHaveLength(name === "Supabase" ? 0 : 1);
      const bounded = buildPassport(timeline);
      const passport = buildPassport(timeline, { areas, crawls: 0, storyPosts: 0 });
      expect(passport.boroughs).toEqual(["City of London"]);
      expect(passport.isEmpty).toBe(false);
      expect(passport.pubs).toBe(bounded.pubs);
      expect(passport.pints).toBe(bounded.pints);
      expect(passport.beers).toBe(bounded.beers);
      expect(passport.badges).toEqual(bounded.badges);
      expect(passport.cheapestPintGbp).toBe(bounded.cheapestPintGbp);
      expect(passport.crawls).toBe(0);
      expect(passport.storyPosts).toBe(0);
      expect(buildPassportShareText({
        displayName: "Local", pubs: passport.pubs, boroughs: passport.boroughs.length,
        cityVisited: true, pints: passport.pints, isEmpty: passport.isEmpty,
      })).toContain("the City of London");
    });

    it("preserves friend gates, withheld attribution, ledger exclusion and city scope", async () => {
      seed(0);
      seed(1, { visibility: "friends", venueId: "venue-wrpmzq" });
      seed(2, { visibility: "anonymous", venueId: "venue-anonymous" });
      seed(3, { visibility: "legacy", venueId: "venue-legacy" });
      seed(4, { status: "hidden", venueId: "venue-hidden" });
      seed(5, { authorRetiredAt: "2026-01-02T00:00:00Z", venueId: "venue-retired" });
      seed(6, { venueId: "venue-mcr-local" });
      expect(await store.listVisibleAuthorVenueIds(author)).toEqual(["venue-eltcmh"]);
      const mutual: ViewerContext = { handle: "local_friend", mutualHandles: new Set([author]) };
      const owner: ViewerContext = { handle: author };
      for (const viewer of [mutual, owner]) {
        expect(await store.listVisibleAuthorVenueIds(author, viewer)).toEqual(["venue-eltcmh", "venue-wrpmzq"]);
      }
      expect(await store.listVisibleAuthorVenueIds(author, { handle: "local_follower", followingHandles: new Set([author]) }))
        .toEqual(["venue-eltcmh"]);
      expect(await store.listVisibleAuthorVenueIds(author, undefined, "manchester")).toEqual(["venue-mcr-local"]);
    });

    it("withholds a withdrawn author's history from strangers but preserves the owner's read", async () => {
      seed(0);
      const profile = __seedMemoryOwnedProfile(author, "disposable_user");
      __setMemoryProfileWithdrawn(profile.id, true);
      expect(await store.listVisibleAuthorVenueIds(author)).toEqual([]);
      expect(await store.listVisibleAuthorVenueIds(author, { handle: author })).toEqual(["venue-eltcmh"]);
    });
  });
}

it("propagates a later Supabase page failure instead of returning partial geography", async () => {
  for (let i = 0; i < 501; i++) seed(i);
  database.failLaterPage = true;
  await expect(supabasePintDropStore.listVisibleAuthorVenueIds(author)).rejects.toThrow("Disposable second-page failure");
});

it("keeps pre-visibility migration rows readable on every Supabase page", async () => {
  for (let i = 0; i < 501; i++) seed(i, { venueId: i === 500 ? "venue-wrpmzq" : "venue-eltcmh" });
  for (const row of database.rows) delete row.visibility;
  database.missingVisibility = true;
  expect(await supabasePintDropStore.listVisibleAuthorVenueIds(author)).toEqual(["venue-eltcmh", "venue-wrpmzq"]);
});
