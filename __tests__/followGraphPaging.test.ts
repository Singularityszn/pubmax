import { beforeEach, describe, expect, it, vi } from "vitest";

// The durable follow graph against a PostgREST double that, like the hosted
// default, answers at most 1,000 rows per request. A read that trusts one
// answer drops edges without an error; the graph readers must page.

type Edge = { id: string; follower_id: string; followee_id: string; follower: string; followee: string };

const backend = vi.hoisted(() => ({
  edges: [] as Edge[],
  maxRows: 1000,
  afterPage: undefined as ((rows: Edge[]) => void) | undefined,
}));

function query() {
  const filters: Array<(edge: Edge) => boolean> = [];
  let ordered = false;
  let rowLimit = Infinity;
  let columns = "";
  function read() {
    const matched = backend.edges.filter((edge) => filters.every((keep) => keep(edge)));
    const page = (ordered ? [...matched].sort((a, b) => a.id.localeCompare(b.id)) : matched)
      .slice(0, Math.min(backend.maxRows, rowLimit));
    const rows = page.map((edge) => ({
      ...(columns.split(",").map((column) => column.trim()).includes("id") ? { id: edge.id } : {}),
      follower: { handle: edge.follower },
      followee: { handle: edge.followee },
    }));
    backend.afterPage?.(page);
    return { data: rows, error: null };
  }
  const builder = {
    select(value: string) {
      columns = value;
      return builder;
    },
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
    gt(_column: "id", value: string) {
      filters.push((edge) => edge.id > value);
      return builder;
    },
    limit(value: number) {
      rowLimit = value;
      return builder;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(read()).then(resolve);
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
  const id = `00000000-0000-0000-0000-${String(backend.edges.length + 1).padStart(12, "0")}`;
  backend.edges.push({ id, follower_id: a.id, followee_id: b.id, follower: from, followee: to });
}

beforeEach(() => {
  backend.edges = [];
  backend.maxRows = 1000;
  backend.afterPage = undefined;
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

  it.each(["following", "followers", "mutuals-out", "mutuals-back"])(
    "keeps every unchanged edge after an earlier deletion during %s",
    async (reader) => {
      for (let index = 0; index < 1002; index += 1) {
        await follow("amy", `mate${index}`);
        await follow(`mate${index}`, "amy");
      }
      const side = reader === "followers" || reader === "mutuals-back" ? "followee" : "follower";
      backend.afterPage = (rows) => {
        const first = rows[0];
        if (!first || first[side] !== "amy") return;
        backend.afterPage = undefined;
        backend.edges = backend.edges.filter((edge) => edge.id !== first.id);
      };

      const store = followStore();
      const handles = reader === "following"
        ? await store.listFollowing("amy")
        : reader === "followers"
          ? await store.listFollowers("amy")
          : (await store.mutualsAmong(["amy"])).get("amy");

      expect(handles).toHaveLength(1002);
      expect(handles).toEqual(expect.arrayContaining(["mate1000", "mate1001"]));
    },
  );
});
