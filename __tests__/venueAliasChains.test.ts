import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadVenueAliasResolver,
  lookupCanonicalVenueId,
  resetVenueAliasesForTests,
  setVenueAliasesPathForTests,
} from "@/lib/venueAliases";
import {
  CITY_VENUE_ALIASES_FILE,
  UK_BASE_VENUE_ALIASES_FILE,
  flattenVenueAliasChains,
} from "@/lib/venueAliasesFile.mjs";
import {
  planUkBaseVenueIdAliases,
  publishUkBaseWithAliases,
} from "../scripts/lib/ukBaseVenueIdAliases.mjs";

// A dropped base id aliases to a curated venue, and a later canonicalisation can
// alias that venue on again, in another artifact. A -> B -> C must read A -> C in
// one step wherever the artifacts are read, and a cycle must be refused.

const LONDON_FILE = "public/data/venue_id_aliases.json";

function writeDoc(file: string, doc: unknown): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

function aliasDir(): string {
  return mkdtempSync(path.join(tmpdir(), "venue-alias-chains-"));
}

afterEach(() => {
  resetVenueAliasesForTests();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("flattenVenueAliasChains", () => {
  it("points every id at the end of its chain", () => {
    const flat = flattenVenueAliasChains([
      ["a", "b"],
      ["b", "c"],
      ["x", "c"],
    ]);
    expect(Object.fromEntries(flat)).toEqual({ a: "c", b: "c", x: "c" });
  });

  it("follows a chain whose links arrive in any order, and a later pair for an id wins", () => {
    expect(
      Object.fromEntries(
        flattenVenueAliasChains([
          ["b", "c"],
          ["c", "d"],
          ["a", "b"],
          ["a", "z"],
        ]),
      ),
    ).toEqual({ a: "z", b: "d", c: "d" });
  });

  it("drops self-maps", () => {
    expect([...flattenVenueAliasChains([["a", "a"]])]).toEqual([]);
  });

  it("refuses a cycle, naming it", () => {
    expect(() =>
      flattenVenueAliasChains([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]),
    ).toThrow("a -> b -> c -> a");
    expect(() =>
      flattenVenueAliasChains([
        ["a", "b"],
        ["b", "a"],
      ]),
    ).toThrow(/cycle/);
  });
});

describe("the server alias reader across the artifacts", () => {
  it("resolves a chain that spans two artifacts in one step, and lists every former id", async () => {
    const dir = aliasDir();
    setVenueAliasesPathForTests([
      writeDoc(path.join(dir, "uk.json"), { aliases: { "venue-uk-n1": "venue-curated" } }),
      writeDoc(path.join(dir, "london.json"), { aliases: { "venue-curated": "venue-canon" } }),
    ]);

    expect(await lookupCanonicalVenueId("venue-uk-n1")).toEqual({
      status: "resolved",
      venueId: "venue-canon",
    });
    const resolver = await loadVenueAliasResolver();
    expect(resolver.canonical("venue-curated")).toBe("venue-canon");
    expect(resolver.storedIds("venue-canon").sort()).toEqual(
      ["venue-canon", "venue-curated", "venue-uk-n1"].sort(),
    );
    expect(resolver.storedIds("venue-uk-n1")[0]).toBe("venue-canon");
  });

  it("reads a cycle as an unreadable alias set, caching nothing", async () => {
    const dir = aliasDir();
    setVenueAliasesPathForTests([
      writeDoc(path.join(dir, "uk.json"), { aliases: { "venue-a": "venue-b" } }),
      writeDoc(path.join(dir, "london.json"), { aliases: { "venue-b": "venue-a" } }),
    ]);
    expect(await lookupCanonicalVenueId("venue-a")).toEqual({ status: "unavailable" });

    writeDoc(path.join(dir, "london.json"), { aliases: { "venue-b": "venue-c" } });
    expect(await lookupCanonicalVenueId("venue-a")).toEqual({
      status: "resolved",
      venueId: "venue-c",
    });
  });
});

describe("the browser alias reader across the artifacts", () => {
  function stubArtifacts(files: Record<string, unknown>): void {
    vi.stubGlobal("fetch", async (url: string) => {
      const doc = files[url];
      return doc === undefined
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify(doc), { status: 200 });
    });
  }

  it("resolves a chain that spans two artifacts in one step", async () => {
    stubArtifacts({
      [`/${LONDON_FILE.replace(/^public\//, "")}`]: { aliases: { "venue-curated": "venue-canon" } },
      [`/${CITY_VENUE_ALIASES_FILE.replace(/^public\//, "")}`]: { aliases: {} },
      [`/${UK_BASE_VENUE_ALIASES_FILE.replace(/^public\//, "")}`]: {
        aliases: { "venue-uk-n1": "venue-curated" },
      },
    });
    const { loadVenueAliasMap } = await import("@/lib/venueAliasMap");
    const aliases = await loadVenueAliasMap();
    expect(aliases.get("venue-uk-n1")).toBe("venue-canon");
    expect(aliases.get("venue-curated")).toBe("venue-canon");
  });

  it("answers as the identity on a cycle", async () => {
    stubArtifacts({
      [`/${LONDON_FILE.replace(/^public\//, "")}`]: { aliases: { "venue-b": "venue-a" } },
      [`/${CITY_VENUE_ALIASES_FILE.replace(/^public\//, "")}`]: { aliases: {} },
      [`/${UK_BASE_VENUE_ALIASES_FILE.replace(/^public\//, "")}`]: { aliases: { "venue-a": "venue-b" } },
    });
    const { loadVenueAliasMap } = await import("@/lib/venueAliasMap");
    expect((await loadVenueAliasMap()).size).toBe(0);
  });
});

describe("planUkBaseVenueIdAliases refuses a cycle across the artifacts", () => {
  const bellNode = ["n1", "The Bell", "", 51.5, -0.1, ""];
  const bellWay = ["w2", "The Bell", "", 51.5003, -0.1, ""];

  function root(londonAliases: Record<string, string>): string {
    const dir = aliasDir();
    writeDoc(path.join(dir, UK_BASE_VENUE_ALIASES_FILE), { version: 1, aliases: {}, retired: {} });
    writeDoc(path.join(dir, LONDON_FILE), { version: 1, aliases: londonAliases });
    return dir;
  }

  it("fails when the new alias closes a loop with another artifact", async () => {
    const dir = root({ "venue-uk-w2": "venue-uk-n1" });
    await expect(
      planUkBaseVenueIdAliases(dir, [bellNode], [bellWay], new Set()),
    ).rejects.toThrow(/cycle/);
  });

  it("plans the alias when the chain runs on without a loop", async () => {
    const dir = root({ "venue-uk-w2": "venue-canon" });
    const plan = await planUkBaseVenueIdAliases(dir, [bellNode], [bellWay], new Set());
    expect(plan.doc).toMatchObject({ aliases: { "venue-uk-n1": "venue-uk-w2" } });
  });
});

describe("publishUkBaseWithAliases", () => {
  function aliasRoot(): { root: string; file: string; held: string } {
    const root = aliasDir();
    const file = path.join(root, UK_BASE_VENUE_ALIASES_FILE);
    const held = JSON.stringify({ version: 1, aliases: { held: "x" }, retired: {} });
    writeDoc(file, JSON.parse(held));
    return { root, file, held };
  }
  const next = { version: 1, aliases: { "venue-uk-n1": "venue-uk-w2" }, retired: {} };

  function files(root: string): string[] {
    return readdirSync(path.dirname(path.join(root, UK_BASE_VENUE_ALIASES_FILE)));
  }

  it("swaps the alias file in after the shards publish", async () => {
    const { root, file } = aliasRoot();
    const seenWhilePublishing: string[] = [];
    const result = await publishUkBaseWithAliases({
      root,
      doc: next,
      publishShards: async () => {
        seenWhilePublishing.push(readFileSync(file, "utf8"));
        return "published";
      },
    });
    expect(result).toBe("published");
    expect(JSON.parse(seenWhilePublishing[0] ?? "{}").aliases).toEqual({ held: "x" });
    expect(JSON.parse(readFileSync(file, "utf8")).aliases).toEqual(next.aliases);
    expect(files(root)).toEqual(["uk_base_venue_id_aliases.json"]);
  });

  it("leaves the alias file, and no staged copy, when the shard publish fails", async () => {
    const { root, file, held } = aliasRoot();
    await expect(
      publishUkBaseWithAliases({
        root,
        doc: next,
        publishShards: async () => {
          throw new Error("publish failed");
        },
      }),
    ).rejects.toThrow("publish failed");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(held));
    expect(files(root)).toEqual(["uk_base_venue_id_aliases.json"]);
  });

  it("publishes nothing when the alias document cannot be staged", async () => {
    const { root } = aliasRoot();
    const publishShards = vi.fn(async () => "published");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      publishUkBaseWithAliases({ root, doc: cyclic, publishShards }),
    ).rejects.toThrow();
    expect(publishShards).not.toHaveBeenCalled();
    expect(files(root)).toEqual(["uk_base_venue_id_aliases.json"]);
  });

  it("only publishes the shards when the refresh needs no alias change", async () => {
    const { root, file, held } = aliasRoot();
    await expect(
      publishUkBaseWithAliases({ root, doc: null, publishShards: async () => "published" }),
    ).resolves.toBe("published");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(held));
  });
});
