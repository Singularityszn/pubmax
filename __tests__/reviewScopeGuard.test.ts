import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  changedFilesFromGit,
  ciFixChurn,
  commitsFromGit,
  KNOWN_FLAKE_SPECS,
  MAX_REVIEW_FILES,
  MAX_RUNTIME_DOMAINS,
  REVIEW_SCOPE_HINTS,
  summarizeReviewScope,
} from "../scripts/check_review_scope.mjs";

describe("review scope guard", () => {
  it("reports source, migration, generated, and evidence files by category", () => {
    const report = summarizeReviewScope([
      "app/api/price-submit/route.ts",
      "lib/communityPriceStore.ts",
      "supabase/migrations/0114_review_scope.sql",
      "public/data/generated/venue-pack.json",
      "docs/proof/review/desktop.png",
    ]);

    expect(report.categoryCounts).toEqual({
      source: 2,
      migration: 1,
      generated: 1,
      evidence: 1,
    });
    expect(report.categories.source).toEqual([
      "app/api/price-submit/route.ts",
      "lib/communityPriceStore.ts",
    ]);
    expect(report.categories.migration).toEqual([
      "supabase/migrations/0114_review_scope.sql",
    ]);
    expect(report.domains).toEqual(["app", "lib"]);
  });

  it("does not count review tooling as a runtime domain", () => {
    const report = summarizeReviewScope([
      "app/api/review/route.ts",
      "lib/reviewScope.ts",
      "scripts/check_review_scope.mjs",
      ".github/workflows/ci.yml",
      "docs/reviews/review-scope.md",
    ]);

    expect(report.domains).toEqual(["app", "lib"]);
    expect(report.warnings).toEqual([]);
    expect(report.categoryCounts).toEqual({
      source: 3,
      evidence: 1,
      config: 1,
    });
  });

  it("still counts script modules imported by Production code", () => {
    const report = summarizeReviewScope([
      "app/api/out/route.ts",
      "lib/out/venueMatch.ts",
      "scripts/whatson/resolveVenueId.mjs",
    ]);

    expect(report.domains).toEqual(["app", "lib", "scripts"]);
    expect(report.warnings).toEqual([
      `review spans ${MAX_RUNTIME_DOMAINS + 1} runtime domains (limit ${MAX_RUNTIME_DOMAINS})`,
    ]);
  });

  it("warns only after the runtime-domain and file-count thresholds", () => {
    const twoDomains = summarizeReviewScope([
      "app/api/example/route.ts",
      "lib/example.ts",
    ]);
    expect(twoDomains.warnings).toEqual([]);

    const threeDomains = summarizeReviewScope([
      "app/api/example/route.ts",
      "components/example.tsx",
      "lib/example.ts",
    ]);
    expect(threeDomains.warnings).toEqual([
      `review spans ${MAX_RUNTIME_DOMAINS + 1} runtime domains (limit ${MAX_RUNTIME_DOMAINS})`,
    ]);

    const manyFiles = summarizeReviewScope(
      Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, index) =>
        `lib/generated-review-${index}.ts`,
      ),
    );
    expect(manyFiles.warnings).toEqual([
      `review changes ${MAX_REVIEW_FILES + 1} files (limit ${MAX_REVIEW_FILES})`,
    ]);
  });

  it("fails only for generated or skill-pack leakage", () => {
    const generated = summarizeReviewScope(["data/generated/venues.json"]);
    expect(generated.ok).toBe(false);
    expect(generated.forbidden).toEqual([
      { category: "generated", path: "data/generated/venues.json" },
    ]);

    const skillPack = summarizeReviewScope(["skills/example/SKILL.md"]);
    expect(skillPack.ok).toBe(false);
    expect(skillPack.forbidden).toEqual([
      { category: "skill-pack", path: "skills/example/SKILL.md" },
    ]);

    const legitimateLargeReview = summarizeReviewScope(
      Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, index) =>
        `app/feature-${index}.ts`,
      ),
    );
    expect(legitimateLargeReview.ok).toBe(true);
    expect(legitimateLargeReview.warnings).not.toEqual([]);
  });

  it("classifies generated venue indexes and build outputs without blocking curated data", () => {
    const generated = [
      "public/data/venues_slim.json",
      "public/data/venues_slim.core.json",
      "public/data/cities/bath/venues_slim.manifest.json",
      "public/data/uk_base/manifest.json",
      "public/data/london_venues/manifest.json",
      "public/data/london_desks/desks.json",
      "public/data/pubmaxxing_seed_snapshot.json",
      "public/data/heritage_listings.json",
      "public/data/historic_pubs.json",
      "data/persona_drinks.json",
    ];
    for (const path of generated) {
      expect(summarizeReviewScope([path]).forbidden).toEqual([
        { category: "generated", path },
      ]);
    }

    const curated = [
      "public/data/uk_base/README.md",
      "public/data/london_venues/README.md",
      "public/data/london_desks/README.md",
      "public/data/london_restaurants/README.md",
      "public/data/drink_price_updates/latest.json",
      "public/data/heritage_cache.json",
    ];
    expect(summarizeReviewScope(curated).forbidden).toEqual([]);
  });

  it("permits a regenerated lane when the diff carries its generator", () => {
    const report = summarizeReviewScope([
      "scripts/build_uk_base_shards.mjs",
      "public/data/uk_base/manifest.json",
      "public/data/uk_base/packs/520da468effa470f/51.50_-0.25.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.categoryCounts).toEqual({ source: 1, regenerated: 2 });
    expect(report.regeneratedLanes).toEqual(["uk_base"]);
  });

  it("permits a regenerated lane when the diff carries its declared source input", () => {
    const report = summarizeReviewScope([
      "data/osm/uk/uk_osm_venues_drink.json",
      "public/data/uk_base/packs/520da468effa470f/51.50_-0.25.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.categoryCounts.regenerated).toBe(1);
  });

  it("permits the slim venue payload when the diff carries the slim builder", () => {
    const report = summarizeReviewScope([
      "scripts/build_slim_index.mjs",
      "public/data/venues_slim.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.categoryCounts).toEqual({ source: 1, regenerated: 1 });
    expect(report.regeneratedLanes).toEqual(["venues_slim"]);
  });

  it.each([
    "public/data/venues_slim.json",
    "public/data/cities/leeds/venues_slim.json",
    "public/data/cities/glasgow/venues_slim.json",
    "data/osm/outer_london_osm_pubs.json",
    "data/cities/leeds/osm_pubs.json",
    "lib/outerLondonOwnership.mjs",
    "lib/cityVenueId.mjs",
    "scripts/build_city_slim_index.mjs",
    "scripts/fetch_city_osm_pubs.mjs",
  ])("permits UK base ownership output when its input changes: %s", (input) => {
    const outputs = [
      "public/data/uk_base/manifest.json",
      "public/data/uk_base/packs/520da468effa470f/51.50_-0.25.json",
    ];
    const report = summarizeReviewScope([input, ...outputs]);

    expect(report.categories.regenerated).toEqual(expect.arrayContaining(outputs));
    expect(report.regeneratedLanes).toContain("uk_base");
    expect(report.forbidden.filter((file) => outputs.includes(file.path))).toEqual([]);
  });

  it.each([
    "public/data/venues_slim.core.json",
    "public/data/cities/leeds/venues_slim.core.json",
    "public/data/cities/glasgow/venues_slim.manifest.json",
    "data/cities/leeds/parallel_venues.json",
  ])("refuses UK base output with an input its builder does not read: %s", (input) => {
    const report = summarizeReviewScope([input, "public/data/uk_base/manifest.json"]);

    expect(report.ok).toBe(false);
    expect(report.regeneratedLanes).not.toContain("uk_base");
    expect(report.forbidden).toContainEqual({
      category: "generated",
      path: "public/data/uk_base/manifest.json",
    });
  });

  it("permits city slim packs when the diff carries a city OSM pack", () => {
    const report = summarizeReviewScope([
      "data/cities/leeds/osm_pubs.json",
      "public/data/cities/leeds/venues_slim.json",
      "public/data/cities/leeds/venues_slim.core.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.categoryCounts).toEqual({ other: 1, regenerated: 2 });
    expect(report.regeneratedLanes).toEqual(["city_venues_slim"]);
  });

  it("permits city slim packs when the diff carries a city discovery pack", () => {
    const report = summarizeReviewScope([
      "data/cities/durham/parallel_venues.json",
      "public/data/cities/durham/venues_slim.json",
      "public/data/cities/durham/venues_slim.core.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.regeneratedLanes).toEqual(["city_venues_slim"]);
  });

  it("permits city slim packs when the diff carries the discovery merge", () => {
    const report = summarizeReviewScope([
      "scripts/lib/parallelVenueDiscovery.mjs",
      "public/data/cities/birmingham/venues_slim.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.regeneratedLanes).toEqual(["city_venues_slim"]);
  });

  it("permits London venue shards when the diff carries the restaurant drinks evidence", () => {
    const report = summarizeReviewScope([
      "data/london_restaurant_drinks/evidence.json",
      "public/data/london_venues/manifest.json",
      "public/data/london_venues/packs/0123456789abcdef/51.500_-0.125.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.regeneratedLanes).toEqual(["london_venues"]);
  });

  it("permits London venue shards when the diff carries the restaurant drinks exclusions", () => {
    const report = summarizeReviewScope([
      "data/london_restaurant_drinks/exclusions.json",
      "public/data/london_venues/manifest.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.regeneratedLanes).toEqual(["london_venues"]);
  });

  it("permits London venue shards and the desk pack when the diff carries the UK venue packs", () => {
    const report = summarizeReviewScope([
      "data/osm/uk/uk_osm_venues_drink.json",
      "public/data/london_venues/manifest.json",
      "public/data/london_venues/packs/0123456789abcdef/51.500_-0.125.json",
      "public/data/london_desks/desks.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.regeneratedLanes).toEqual(["london_venues", "london_desks"]);
  });

  it("refuses a London desk pack that nothing in the diff produced", () => {
    const report = summarizeReviewScope([
      "data/london_restaurant_drinks/evidence.json",
      "public/data/london_desks/desks.json",
    ]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/london_desks/desks.json" },
    ]);
  });

  it("permits the London restaurant pack when the diff carries its builder or the shards it is cut from", () => {
    for (const producer of [
      "scripts/build_london_restaurant_pack.mjs",
      "public/data/london_venues/manifest.json",
    ]) {
      const report = summarizeReviewScope([
        producer,
        "public/data/london_restaurants/restaurants.json",
      ]);
      expect(report.forbidden).toEqual(
        producer.startsWith("public/")
          ? [{ category: "generated", path: producer }]
          : [],
      );
      expect(report.regeneratedLanes).toContain("london_restaurants");
    }
  });

  it("refuses a London restaurant pack that nothing in the diff produced", () => {
    const report = summarizeReviewScope(["public/data/london_restaurants/restaurants.json"]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/london_restaurants/restaurants.json" },
    ]);
  });

  it("refuses London venue shards that nothing in the diff produced", () => {
    const report = summarizeReviewScope(["public/data/london_venues/manifest.json"]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/london_venues/manifest.json" },
    ]);
  });

  it("permits the UK pub search index when the diff carries the UK OSM pack", () => {
    const report = summarizeReviewScope([
      "data/osm/uk/uk_osm_pubs.json",
      "data/generated/uk_pub_search.json",
    ]);

    expect(report.ok).toBe(true);
    expect(report.regeneratedLanes).toEqual(["uk_pub_search"]);
  });

  it.each([
    "scripts/build_historic_index.mjs",
    "public/data/heritage_cache.json",
    "public/data/pint_prices_app_dataset.json",
    "public/data/venue_id_aliases.json",
    "lib/heritageLanguageGate.mjs",
    "lib/heritagePlaceConflict.mjs",
    "lib/heritageDate.mjs",
  ])("permits the historic directory when its producer changes: %s", (input) => {
    const report = summarizeReviewScope([input, "public/data/historic_pubs.json"]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.categories.regenerated).toEqual(["public/data/historic_pubs.json"]);
    expect(report.regeneratedLanes).toEqual(["historic_pubs"]);
    expect(report.reviewFileCount).toBe(1);
  });

  it("keeps other generated output forbidden beside the historic builder", () => {
    const report = summarizeReviewScope([
      "scripts/build_historic_index.mjs",
      "public/data/historic_pubs.json",
      "public/data/heritage_listings.json",
      "public/data/venues_slim.json",
    ]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/heritage_listings.json" },
      { category: "generated", path: "public/data/venues_slim.json" },
    ]);
    expect(report.regeneratedLanes).toEqual(["historic_pubs"]);
  });

  it("keeps historic output forbidden beside an unrelated builder", () => {
    const report = summarizeReviewScope([
      "scripts/build_heritage_listings.mjs",
      "public/data/historic_pubs.json",
    ]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/historic_pubs.json" },
    ]);
    expect(report.regeneratedLanes).toEqual([]);
  });

  it("permits generated database types when the diff carries a migration", () => {
    const report = summarizeReviewScope([
      "supabase/migrations/20260101000000_example.sql",
      "types/database.ts",
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.regeneratedLanes).toEqual(["database_types"]);
  });

  it("permits generated database types when the diff carries the generator", () => {
    const report = summarizeReviewScope([
      "scripts/db/generate-database-types.mjs",
      "types/database.ts",
    ]);

    expect(report.ok).toBe(true);
    expect(report.categoryCounts).toEqual({ source: 1, regenerated: 1 });
    expect(report.regeneratedLanes).toEqual(["database_types"]);
  });

  it("forbids a hand-edited database type file", () => {
    const report = summarizeReviewScope(["types/database.ts"]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "types/database.ts" },
    ]);
    expect(report.regeneratedLanes).toEqual([]);
  });

  it("keeps city slim packs and the UK search index forbidden without their inputs", () => {
    const report = summarizeReviewScope([
      "public/data/pint_prices_app_dataset.json",
      "public/data/cities/leeds/venues_slim.json",
      "data/generated/uk_pub_search.json",
    ]);

    expect(report.forbidden).toEqual([
      { category: "generated", path: "data/generated/uk_pub_search.json" },
      { category: "generated", path: "public/data/cities/leeds/venues_slim.json" },
    ]);
  });

  it("keeps a lane forbidden when nothing in the diff produced it", () => {
    const report = summarizeReviewScope([
      "public/data/uk_base/packs/520da468effa470f/51.50_-0.25.json",
      "components/map/PubMap.tsx",
    ]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      {
        category: "generated",
        path: "public/data/uk_base/packs/520da468effa470f/51.50_-0.25.json",
      },
    ]);
    expect(report.regeneratedLanes).toEqual([]);
  });

  it("permits one lane without permitting another", () => {
    const report = summarizeReviewScope([
      "scripts/build_uk_base_shards.mjs",
      "public/data/uk_base/manifest.json",
      "public/data/venues_slim.json",
    ]);

    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/venues_slim.json" },
    ]);
  });

  it("allows the project skill root and a deleted skill path outside it", () => {
    const report = summarizeReviewScope([
      { path: ".agents/skills/animate/SKILL.md", status: "A" },
      { path: ".agents/skills", status: "M" },
      { path: "skills/impeccable/SKILL.md", status: "D" },
      { path: ".cursor/skills/example/SKILL.md", status: "D" },
      { path: "lib/skills/helper.mjs", status: "D" },
    ]);

    expect(report.ok).toBe(true);
    expect(report.forbidden).toEqual([]);
    expect(report.categories["skill-pack"]).toBeUndefined();
  });

  it("fails an added or modified skill path outside the project root", () => {
    const report = summarizeReviewScope([
      { path: "skills/example/SKILL.md", status: "A" },
      { path: ".cursor/skills/example/SKILL.md", status: "M" },
      { path: "lib/skills/helper.mjs", status: "R" },
      { path: ".agents/skills/animate/SKILL.md", status: "A" },
    ]);

    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([
      { category: "skill-pack", path: ".cursor/skills/example/SKILL.md" },
      { category: "skill-pack", path: "lib/skills/helper.mjs" },
      { category: "skill-pack", path: "skills/example/SKILL.md" },
    ]);
  });

  it("never permits a skill pack, whatever else the diff carries", () => {
    const report = summarizeReviewScope([
      "scripts/build_uk_base_shards.mjs",
      "public/data/uk_base/manifest.json",
      "skills/example/SKILL.md",
    ]);

    expect(report.forbidden).toEqual([
      { category: "skill-pack", path: "skills/example/SKILL.md" },
    ]);
  });

  it("leaves a regenerated lane out of the human-review count", () => {
    const shards = Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, index) =>
      `public/data/uk_base/packs/520da468effa470f/cell-${index}.json`,
    );
    const report = summarizeReviewScope([
      "scripts/build_uk_base_shards.mjs",
      ...shards,
    ]);

    expect(report.fileCount).toBe(shards.length + 1);
    expect(report.reviewFileCount).toBe(1);
    expect(report.warnings).toEqual([]);
  });

  it("forbids an added skill pack and allows a deletion plus the project root", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-skills-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      mkdirSync(join(repo, "skills/impeccable"), { recursive: true });
      writeFileSync(join(repo, "skills/impeccable/SKILL.md"), "old impeccable body that must leave the tree\n");
      git("add", ".");
      git("commit", "-qm", "seed skill pack");
      const base = git("rev-parse", "HEAD");

      rmSync(join(repo, "skills"), { recursive: true });
      mkdirSync(join(repo, ".agents/skills/animate"), { recursive: true });
      writeFileSync(join(repo, ".agents/skills/animate/SKILL.md"), "animate project skill body\n");
      mkdirSync(join(repo, "skills/fresh"), { recursive: true });
      writeFileSync(join(repo, "skills/fresh/SKILL.md"), "brand new skill pack body\n");
      git("add", "-A");
      git("commit", "-qm", "replace skill pack");
      const head = git("rev-parse", "HEAD");

      const report = summarizeReviewScope(changedFilesFromGit(base, head, repo));
      expect(report.ok).toBe(false);
      expect(report.forbidden).toEqual([
        { category: "skill-pack", path: "skills/fresh/SKILL.md" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps deleted generated paths in the changed-file report", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      mkdirSync(join(repo, "data/generated"), { recursive: true });
      writeFileSync(join(repo, "data/generated/venues.json"), "{}\n");
      git("add", ".");
      git("commit", "-qm", "seed generated path");
      const base = git("rev-parse", "HEAD");
      rmSync(join(repo, "data/generated/venues.json"));
      git("commit", "-am", "delete generated path");
      const head = git("rev-parse", "HEAD");

      expect(changedFilesFromGit(base, head, repo)).toEqual([
        { path: "data/generated/venues.json", status: "D" },
      ]);
      expect(summarizeReviewScope(changedFilesFromGit(base, head, repo)).forbidden).toEqual([
        { category: "generated", path: "data/generated/venues.json" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses an empty-tree diff for an all-zero base SHA", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-zero-base-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      mkdirSync(join(repo, "public/data"), { recursive: true });
      writeFileSync(join(repo, "public/data/venues_slim.json"), "{}\n");
      git("add", ".");
      git("commit", "-qm", "seed first branch");
      const head = git("rev-parse", "HEAD");

      const files = changedFilesFromGit("0".repeat(40), head, repo);
      expect(files).toEqual([{ path: "public/data/venues_slim.json", status: "A" }]);
      expect(summarizeReviewScope(files).ok).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("prints the hint for each forbidden category on stderr", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-hint-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    const runCli = (base: string, head: string) => {
      try {
        const stdout = execFileSync(
          process.execPath,
          [
            join(process.cwd(), "scripts/check_review_scope.mjs"),
            "--base",
            base,
            "--head",
            head,
            "--repo",
            repo,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
        return { status: 0, stdout, stderr: "" };
      } catch (error) {
        const failed = error as { status?: number; stdout?: string; stderr?: string };
        return {
          status: failed.status ?? 1,
          stdout: failed.stdout ?? "",
          stderr: failed.stderr ?? "",
        };
      }
    };

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      writeFileSync(join(repo, "README.md"), "before\n");
      git("add", ".");
      git("commit", "-qm", "seed readme");
      const readmeBase = git("rev-parse", "HEAD");
      writeFileSync(join(repo, "README.md"), "after\n");
      git("add", ".");
      git("commit", "-qm", "edit readme");
      const readmeHead = git("rev-parse", "HEAD");
      const clean = runCli(readmeBase, readmeHead);
      expect(clean.status).toBe(0);
      expect(clean.stderr).toBe("");
      expect(JSON.parse(clean.stdout).ok).toBe(true);

      mkdirSync(join(repo, "public/data"), { recursive: true });
      writeFileSync(join(repo, "public/data/venues_slim.json"), "{}\n");
      git("add", ".");
      git("commit", "-qm", "add generated pack");
      const generatedHead = git("rev-parse", "HEAD");
      const failed = runCli(readmeHead, generatedHead);
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stdout).ok).toBe(false);
      expect(failed.stderr).toBe(`${REVIEW_SCOPE_HINTS.generated}\n`);
      expect(REVIEW_SCOPE_HINTS.generated).toBe(
        "Generated output in this diff has no declared lane. If its generator inputs are in the diff, add a lane to REGENERATED_LANES (scripts/check_review_scope.mjs); rule: docs/rules/scripts-ci-gates-and-audits.md#a-generated-lane-may-ride-the-review-that-produced-it-and-nothing-else-may",
      );

      mkdirSync(join(repo, "skills/example"), { recursive: true });
      writeFileSync(join(repo, "skills/example/SKILL.md"), "# example\n");
      git("add", ".");
      git("commit", "-qm", "add skill pack");
      const skillHead = git("rev-parse", "HEAD");
      const skillOnly = runCli(generatedHead, skillHead);
      expect(skillOnly.status).toBe(1);
      expect(JSON.parse(skillOnly.stdout).ok).toBe(false);
      expect(skillOnly.stderr).toBe(`${REVIEW_SCOPE_HINTS["skill-pack"]}\n`);
      expect(REVIEW_SCOPE_HINTS["skill-pack"]).toBe(
        "A skill pack in this diff sits outside the project skill root. Move it under .agents/skills/; rule: docs/rules/scripts-ci-gates-and-audits.md#a-generated-lane-may-ride-the-review-that-produced-it-and-nothing-else-may",
      );

      const both = runCli(readmeHead, skillHead);
      expect(both.status).toBe(1);
      expect(both.stderr).toBe(
        `${REVIEW_SCOPE_HINTS.generated}\n${REVIEW_SCOPE_HINTS["skill-pack"]}\n`,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("CI-step fix commits", () => {
  it("flags bundled data and a known-flake spec in a no-mistakes(ci) commit", () => {
    const churn = ciFixChurn([
      {
        sha: "ci",
        subject: "no-mistakes(ci): Browser law pins failed",
        paths: ["e2e/map-surface-history.spec.ts", "lib/plan.ts", "public/data/venues_slim.core.json"],
      },
    ]);

    expect(churn).toEqual([
      { sha: "ci", path: "e2e/map-surface-history.spec.ts", category: "ci-flake" },
      { sha: "ci", path: "public/data/venues_slim.core.json", category: "ci-data" },
    ]);
  });

  it("names only known-flake specs that exist", () => {
    expect(KNOWN_FLAKE_SPECS).toContain("e2e/map-surface-history.spec.ts");
    for (const spec of KNOWN_FLAKE_SPECS) expect(existsSync(join(process.cwd(), spec))).toBe(true);
  });

  it("leaves data-lane review and document fixes, other pipeline subjects, people and READMEs alone", () => {
    expect(
      ciFixChurn([
        { sha: "review", subject: "no-mistakes(review): Rebuild shards", paths: ["public/data/venues_slim.json"] },
        { sha: "doc", subject: "no-mistakes(document): Refresh docs", paths: ["public/data/uk_base/a.json"] },
        {
          sha: "test",
          subject: "no-mistakes(test): Pin the flake",
          paths: ["e2e/map-surface-history.spec.ts"],
        },
        { sha: "fallback", subject: "no-mistakes: apply agent fixes", paths: ["public/data/venues_slim.json"] },
        { sha: "author", subject: "feat(data): add pubs", paths: ["public/data/venues_slim.json"] },
        {
          sha: "revert",
          subject: 'Revert "no-mistakes(ci): Browser law pins failed"',
          paths: ["public/data/venues_slim.json", "e2e/map-surface-history.spec.ts"],
        },
        {
          sha: "ci-notes",
          subject: "no-mistakes(ci): Correct price notes",
          paths: ["public/data/uk_prices/README.md", "public/data/AGENTS.md"],
        },
      ]),
    ).toEqual([]);
  });

  it("fails a --ci-commits run on CI churn a revert hid, and ignores it without the flag", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-ci-fix-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    const scope = (base: string, head: string, ...flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          join(process.cwd(), "scripts/check_review_scope.mjs"),
          "--base",
          base,
          "--head",
          head,
          "--repo",
          repo,
          ...flags,
        ],
        { encoding: "utf8" },
      );

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      mkdirSync(join(repo, "public/data"), { recursive: true });
      mkdirSync(join(repo, "e2e"), { recursive: true });
      writeFileSync(join(repo, "public/data/venues_slim.json"), '{"revision":"local"}\n');
      writeFileSync(join(repo, "e2e/map-surface-history.spec.ts"), "// spec\n");
      git("add", ".");
      git("commit", "-qm", "seed");
      const base = git("rev-parse", "HEAD");

      mkdirSync(join(repo, "scripts"), { recursive: true });
      writeFileSync(join(repo, "scripts/build_slim_index.mjs"), "// fixed builder\n");
      writeFileSync(join(repo, "public/data/venues_slim.json"), '{"revision":"rebuilt"}\n');
      git("add", "-A");
      git("commit", "-qm", "no-mistakes(review): Fix the slim builder and rebuild shards");
      const reviewed = git("rev-parse", "HEAD");

      const reviewOnly = scope(base, reviewed, "--ci-commits");
      expect(reviewOnly.status).toBe(0);
      expect(JSON.parse(reviewOnly.stdout).ciChurn).toEqual([]);

      writeFileSync(join(repo, "public/data/venues_slim.json"), '{"revision":"746811cfdddc"}\n');
      writeFileSync(join(repo, "e2e/map-surface-history.spec.ts"), "// retried\n");
      git("commit", "-qam", "no-mistakes(ci): Browser law pins failed");
      const churned = git("rev-parse", "HEAD");
      git("revert", "--no-edit", churned);
      const head = git("rev-parse", "HEAD");

      expect(commitsFromGit(reviewed, head, repo).map((commit) => commit.paths)).toEqual([
        ["e2e/map-surface-history.spec.ts", "public/data/venues_slim.json"],
        ["e2e/map-surface-history.spec.ts", "public/data/venues_slim.json"],
      ]);
      expect(summarizeReviewScope(changedFilesFromGit(reviewed, head, repo)).ok).toBe(true);

      const push = scope(base, head);
      expect(push.status).toBe(0);
      expect(JSON.parse(push.stdout).ciChurn).toEqual([]);
      expect(push.stderr).toBe("");

      const result = scope(base, head, "--ci-commits");
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).ciChurn).toEqual([
        { sha: churned, path: "e2e/map-surface-history.spec.ts", category: "ci-flake" },
        { sha: churned, path: "public/data/venues_slim.json", category: "ci-data" },
      ]);
      expect(result.stderr).toBe(`${REVIEW_SCOPE_HINTS["ci-data"]}\n${REVIEW_SCOPE_HINTS["ci-flake"]}\n`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
