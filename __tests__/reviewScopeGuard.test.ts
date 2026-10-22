import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  changedFilesFromGit,
  classifyReviewFile,
  MAX_REVIEW_FILES,
  MAX_RUNTIME_DOMAINS,
  summarizeReviewScope,
} from "../scripts/check_review_scope.mjs";

describe("review scope guard", () => {
  const retiredHelperPaths = [
    ".agents/skills/enhance-readme/package.json",
    ".agents/skills/enhance-readme/package-lock.json",
    ".agents/skills/orchestrate/scripts/package.json",
    ".agents/skills/orchestrate/scripts/bun.lock",
    ".agents/skills/poteto-mode/scripts/package.json",
    ".agents/skills/poteto-mode/scripts/bun.lock",
    "skills/enhance-readme/package.json",
    "skills/enhance-readme/package-lock.json",
  ] as const;

  function withProjectSkillDiff(
    check: (repo: string, base: string, git: (...args: string[]) => string) => void,
  ) {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-project-skill-review-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      for (const path of retiredHelperPaths) {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), "{}\n");
      }
      git("add", ".");
      git("commit", "-qm", "seed retired helper metadata");
      const base = git("rev-parse", "HEAD");
      for (const path of retiredHelperPaths) rmSync(join(repo, path));
      mkdirSync(join(repo, ".agents/skills/animate"), { recursive: true });
      writeFileSync(join(repo, ".agents/skills/animate/SKILL.md"), "# Animate\nProject UI instructions.\n");
      check(repo, base, git);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  function runGuard(repo: string, base: string, head: string) {
    const result = spawnSync(process.execPath, [
      resolve("scripts/check_review_scope.mjs"), "--base", base, "--head", head, "--repo", repo,
    ], { encoding: "utf8", timeout: 10_000 });
    if (result.error) throw result.error;
    return { status: result.status, stderr: result.stderr, report: JSON.parse(result.stdout) };
  }

  it("allows retired helper deletions and a project UI skill through the public CLI", () => {
    withProjectSkillDiff((repo, base, git) => {
      git("add", "-A");
      git("commit", "-qm", "keep project UI skill and delete retired helpers");
      const result = runGuard(repo, base, git("rev-parse", "HEAD"));
      expect(result.stderr).toBe("");
      expect({ status: result.status, forbidden: result.report.forbidden }).toEqual({ status: 0, forbidden: [] });
      expect(result.report.categoryCounts).toEqual({ other: 9 });
      expect(result.report.fileCount).toBe(9);
      expect(result.report.reviewFileCount).toBe(9);
      expect(result.report.domains).toEqual([]);
    });
  });

  it.each([
    ["skills/enhance-readme/SKILL.md", "skill-pack"],
    [".cursor/skills/animate/SKILL.md", "skill-pack"],
    ["skills/enhance-readme/scripts/record-readme-tour.mjs", "skill-pack"],
    ["lib/skills/unrelated/package.json", "skill-pack"],
    ["skills/unrelated/package-lock.json", "skill-pack"],
    ["skills/orchestrate/scripts/package-lock.json", "skill-pack"],
    ["data/generated/venue-pack.json", "generated"],
  ])("rejects %s beside project UI skills and retired helper deletions through the public CLI", (path, category) => {
    withProjectSkillDiff((repo, base, git) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      const content = path.endsWith("SKILL.md")
        ? "# Example skill\nInstructions outside the project skill root.\n"
        : path.endsWith(".mjs")
          ? "export const tour = () => 'changed helper source';\n"
          : `${JSON.stringify({ private: true, dependencies: { commander: "15.0.0" } })}\n`;
      writeFileSync(join(repo, path), content);
      git("add", "-A");
      git("commit", "-qm", "delete retired helpers and add forbidden content");
      const result = runGuard(repo, base, git("rev-parse", "HEAD"));
      expect(result.stderr).toBe("");
      expect(result.status).toBe(1);
      expect(result.report.forbidden).toEqual([{ category, path }]);
      expect(result.report.ok).toBe(false);
    });
  });

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
    expect(summarizeReviewScope(generated).forbidden).toEqual(
      generated.sort().map((path) => ({ category: "generated", path })),
    );

    const curated = [
      "public/data/uk_base/README.md",
      "public/data/london_venues/README.md",
      "public/data/london_desks/README.md",
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

  it("classifies a deleted outside-root path when its public caller supplies Git status", () => {
    expect(classifyReviewFile("skills/enhance-readme/package.json", "D")).toEqual({
      path: "skills/enhance-readme/package.json",
      category: "other",
      domain: null,
    });
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

      const files: Array<{ path: string; status: string }> = changedFilesFromGit("0".repeat(40), head, repo);
      expect(files).toEqual([{ path: "public/data/venues_slim.json", status: "A" }]);
      expect(summarizeReviewScope(files).ok).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
