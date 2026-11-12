import { beforeEach, describe, expect, it, vi } from "vitest";

// The durable follow graph against a PostgREST double that, like the hosted
// default, answers at most 1,000 rows per request. A read that trusts one
// answer drops edges without an error; the graph readers must page.

type Edge = { id: number; follower_id: string; followee_id: string; follower: string; followee: string };

const backend = vi.hoisted(() => ({ edges: [] as Edge[], maxRows: 1000 }));

function query() {
  const filters: Array<(edge: Edge) => boolean> = [];
  let ordered = false;
  const builder = {
    select: () => builder,
    eq(column: keyof Edge, value: string) {
      filters.push((edge) => edge[column] === value);
      return builder;
    },
    in(column: string, values: string[]) {
      const side = column.split(".")[0] as "follower" | "followee";
      filters.push((edge) => values.includes(edge[side]));
      return builder;
    },
    order() {
      ordered = true;
      return builder;
    },
    range(from: number, to: number) {
      const matched = backend.edges.filter((edge) => filters.every((keep) => keep(edge)));
      const rows = (ordered ? [...matched].sort((a, b) => a.id - b.id) : matched)
        .slice(from, Math.min(to + 1, from + backend.maxRows))
        .map((edge) => ({ follower: { handle: edge.follower }, followee: { handle: edge.followee } }));
      return Promise.resolve({ data: rows, error: null });
    },
    then(resolve: (value: unknown) => unknown) {
      const rows = backend.edges
        .filter((edge) => filters.every((keep) => keep(edge)))
        .slice(0, backend.maxRows)
        .map((edge) => ({ follower: { handle: edge.follower }, followee: { handle: edge.followee } }));
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => query() }),
  };
});
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return { ...actual, supabaseProfileStore: actual.memoryProfileStore };
});

import { followStore } from "@/lib/followStore";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

async function follow(from: string, to: string): Promise<void> {
  const [a, b] = await Promise.all([memoryProfileStore.ensure(from), memoryProfileStore.ensure(to)]);
  backend.edges.push({ id: backend.edges.length + 1, follower_id: a.id, followee_id: b.id, follower: from, followee: to });
}

beforeEach(() => {
  backend.edges = [];
  backend.maxRows = 1000;
  __resetMemoryProfiles();
});

describe("durable follow graph reads past the response cap", () => {
  it("lists every followee and follower, and every mutual among many", async () => {
    // amy and 1,200 others follow each other both ways.
    for (let index = 0; index < 1200; index += 1) {
      await follow("amy", `mate${index}`);
      await follow(`mate${index}`, "amy");
    }

    expect(await followStore().listFollowing("amy")).toHaveLength(1200);
    expect(await followStore().listFollowers("amy")).toHaveLength(1200);
    const lots = await followStore().mutualsAmong(["amy", "mate0"]);
    expect(lots.get("amy")).toHaveLength(1200);
    expect(lots.get("mate0")).toEqual(["amy"]);
  });

  it("keeps paging when the server answers fewer rows than were asked for", async () => {
    backend.maxRows = 300;
    for (let index = 0; index < 700; index += 1) await follow("amy", `mate${index}`);
    expect(await followStore().listFollowing("amy")).toHaveLength(700);
  });
});
