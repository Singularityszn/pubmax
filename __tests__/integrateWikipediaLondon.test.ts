import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The integration script exports its pure guards for testing; importing it must
// not run main() (guarded by the process.argv[1] === import.meta.url check).
// @ts-expect-error — .mjs script has no type declarations.
import { inLondon, loadJson, resolveMatch } from "@/scripts/integrate_wikipedia_london_pubs.mjs";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "integrate-wiki-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("inLondon bounds check (item 1)", () => {
  it("accepts central London", () => {
    expect(inLondon(51.5072, -0.1276)).toBe(true);
  });

  it("accepts the inclusive corners of the box", () => {
    expect(inLondon(51.26, -0.55)).toBe(true);
    expect(inLondon(51.72, 0.3)).toBe(true);
  });

  it("REJECTS a point east of the upper longitude bound", () => {
    // Regression: the old check compared LON_MAX <= LON_MAX (always true), so
    // the eastern edge was never enforced and this returned true.
    expect(inLondon(51.5, 0.5)).toBe(false);
    expect(inLondon(51.5, 2.0)).toBe(false);
  });

  it("rejects points outside the other three bounds", () => {
    expect(inLondon(51.5, -0.9)).toBe(false); // west of LON_MIN
    expect(inLondon(51.0, -0.1)).toBe(false); // south of LAT_MIN
    expect(inLondon(52.0, -0.1)).toBe(false); // north of LAT_MAX
  });
});

describe("loadJson error handling (item 2)", () => {
  it("returns the fallback when the file is missing (ENOENT)", () => {
    const dir = tmp();
    expect(loadJson(join(dir, "does-not-exist.json"), { seeded: true })).toEqual({
      seeded: true,
    });
  });

  it("parses and returns an existing valid JSON file", () => {
    const dir = tmp();
    const path = join(dir, "data.json");
    writeFileSync(path, JSON.stringify([{ ok: 1 }]), "utf8");
    expect(loadJson(path, null)).toEqual([{ ok: 1 }]);
  });

  it("throws loudly on a corrupt/partial existing file instead of returning fallback", () => {
    const dir = tmp();
    const path = join(dir, "corrupt.json");
    writeFileSync(path, '{"pubs": [', "utf8"); // truncated JSON
    expect(() => loadJson(path, [])).toThrow(/Failed to parse/);
  });

  it("throws loudly on a non-ENOENT read error (path is a directory)", () => {
    const dir = tmp();
    const sub = join(dir, "adir");
    mkdirSync(sub);
    expect(() => loadJson(sub, [])).toThrow(/Failed to read/);
  });
});

describe("Wikipedia integration run from a cached read", () => {
  const wiki = (slug: string) => `https://en.wikipedia.org/wiki/${slug}`;

  function fixture() {
    const root = tmp();
    const copy = (path: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(join(process.cwd(), path), join(root, path));
    };
    const write = (path: string, value: unknown) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    };
    copy("scripts/integrate_wikipedia_london_pubs.mjs");
    copy("scripts/lib/venueMatch.mjs");
    copy("scripts/lib/geo.mjs");
    copy("lib/greatCircle.mjs");
    write("scripts/lib/boroughFromPoint.mjs", "export const loadBoroughIndex = () => ({});\nexport const boroughForPoint = () => \"Camden\";\n");
    write("data/wikipedia_london_pubs.json", {
      source: "fixture list",
      pubs: [
        { name: "Old Crown", url: wiki("Old_Crown"), sources: ["table"] },
        { name: "Bare Crown", url: wiki("Bare_Crown"), sources: ["table"] },
        { name: "New Swan", url: wiki("New_Swan"), sources: ["table"] },
        { name: "Far Swan", url: wiki("Far_Swan"), sources: ["table"] },
        { name: "Lost Swan", url: wiki("Lost_Swan"), sources: ["table"] },
        { name: "Many Swans", url: wiki("Many_Swans"), sources: ["table"] },
        { name: "Broken Swan", url: wiki("Broken_Swan"), sources: ["table"] },
      ],
    });
    const existing = (name: string, latitude: number, extra: Record<string, unknown>) => ({
      app_price_id: "app_price_000007",
      pub_name: name,
      address: `${name} Street`,
      latitude,
      longitude: -0.12,
      ...extra,
    });
    write("public/data/pint_prices_app_dataset.json", [
      existing("Old Crown", 51.51, { source_datasets: "osm", description: "", comment: "Listed" }),
      existing("Bare Crown", 51.52, {}),
    ]);
    write("public/data/heritage_cache.json", {
      "old crown": [{ source: "wikipedia", fact: "An older fact.", sourceRef: wiki("Old_Crown") }],
    });
    const summary = (title: string, lat: number | null, extra: Record<string, unknown> = {}) => ({
      title,
      extract: `${title} is a pub. It has a second sentence.`,
      pageUrl: wiki(title.replace(/ /g, "_")),
      lat,
      lng: lat === null ? null : -0.12,
      type: "standard",
      source: "wikidata",
      ...extra,
    });
    write("data/generated/wikipedia_fetch_cache.json", {
      [wiki("Old_Crown")]: summary("Old Crown", 51.5101),
      [wiki("Bare_Crown")]: summary("Bare Crown", 51.5201, { source: "wikipedia", pageUrl: "" }),
      [wiki("New_Swan")]: summary("New Swan", 51.53),
      [wiki("Far_Swan")]: summary("Far Swan", 52.4),
      [wiki("Lost_Swan")]: summary("Lost Swan", null),
      [wiki("Many_Swans")]: summary("Many Swans", 51.54, { type: "disambiguation" }),
      [wiki("Broken_Swan")]: { error: true, pageUrl: wiki("Broken_Swan"), title: "Broken Swan" },
    });
    return root;
  }

  const read = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

  it("annotates matched venues, adds an in-London venue, and reports every skip", () => {
    const root = fixture();
    const env = { ...process.env };
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    // The script runs main only when argv[1] is its own resolved path.
    const script = realpathSync(join(root, "scripts/integrate_wikipedia_london_pubs.mjs"));
    const run = spawnSync(process.execPath, [script, "--skip-fetch"], { cwd: root, encoding: "utf8", env });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Done.");

    const [oldCrown, bareCrown, newSwan, ...rest] = read(root, "public/data/pint_prices_app_dataset.json");
    expect(rest).toEqual([]);
    expect(oldCrown).toMatchObject({
      source_datasets: "osm|wikipedia_london_list",
      description: "Old Crown is a pub.",
      comment: `Listed | Wikipedia: ${wiki("Old_Crown")}`,
    });
    expect(bareCrown).toMatchObject({
      source_datasets: "wikipedia_london_list",
      description: "Bare Crown is a pub.",
      comment: `Wikipedia: ${wiki("Bare_Crown")}`,
    });
    expect(newSwan).toMatchObject({
      app_price_id: "app_price_000008",
      pub_name: "New Swan",
      primary_borough: "Camden",
      description: "New Swan is a pub.",
      comment: `Wikipedia: ${wiki("New_Swan")}`,
      source_datasets: "wikipedia_london_list",
    });

    expect(read(root, "public/data/heritage_cache.json")).toEqual({
      "old crown": [
        { source: "wikipedia", fact: "An older fact.", sourceRef: wiki("Old_Crown") },
        { source: "wikidata", fact: "Old Crown is a pub.", sourceRef: wiki("Old_Crown") },
      ],
      "bare crown": [{ source: "wikipedia", fact: "Bare Crown is a pub.", sourceRef: wiki("Bare_Crown") }],
      "new swan": [{ source: "wikidata", fact: "New Swan is a pub.", sourceRef: wiki("New_Swan") }],
    });

    const report = read(root, "data/generated/wikipedia_integration_report.json");
    expect(report).toMatchObject({
      source: "fixture list",
      processed: 7,
      matched: 2,
      heritageAdded: 2,
      venuesAdded: 1,
      skippedNoCoords: 1,
      skippedOutOfLondon: 1,
      skippedDuplicate: 0,
      skippedNoExtract: 1,
      errors: 1,
    });
    expect(report.unmatched.map((row: { name: string; reason: string }) => [row.name, row.reason])).toEqual([
      ["Far Swan", "out_of_london"],
      ["Lost Swan", "no_coordinates"],
    ]);

    // A second run finds every fact already cached and every venue present.
    const again = spawnSync(process.execPath, [script, "--skip-fetch"], { cwd: root, encoding: "utf8", env });
    expect(again.status, again.stderr).toBe(0);
    const second = read(root, "data/generated/wikipedia_integration_report.json");
    expect(second).toMatchObject({ matched: 3, heritageAdded: 0, venuesAdded: 0 });
    const [oldAgain] = read(root, "public/data/pint_prices_app_dataset.json");
    expect(oldAgain.comment).toBe(`Listed | Wikipedia: ${wiki("Old_Crown")}`);
  });
});

describe("Wikipedia venue distance gate", () => {
  const pub = { name: "Boundary Arms", url: "https://en.wikipedia.org/wiki/Boundary_Arms" };
  const summary = { title: "Boundary Arms", lat: 51.5, lng: -0.1 };

  function indexesAt(distanceMetres: number) {
    const latitudeDelta = (distanceMetres / 6_371_000) * (180 / Math.PI);
    return {
      nameToKeys: new Map([["boundary arms", ["venue-boundary"]]]),
      rowsByKey: new Map([[
        "venue-boundary",
        { latitude: summary.lat + latitudeDelta, longitude: summary.lng },
      ]]),
    };
  }

  it("accepts a same-name venue inside 350 metres", () => {
    expect(resolveMatch(pub, summary, indexesAt(349.9))).toBe("venue-boundary");
  });

  it("rejects a same-name venue outside 350 metres", () => {
    expect(resolveMatch(pub, summary, indexesAt(350.1))).toBeNull();
  });
});
