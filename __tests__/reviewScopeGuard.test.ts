import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  changedFilesFromGit,
  localChangesFromGit,
  MAX_REVIEW_FILES,
  MAX_RUNTIME_DOMAINS,
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
      "scripts/check_review_scope.d.mts",
      ".github/workflows/ci.yml",
      "docs/reviews/review-scope.md",
    ]);

    expect(report.domains).toEqual(["app", "lib"]);
    expect(report.warnings).toEqual([]);
    expect(report.categoryCounts).toEqual({
      source: 4,
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
      Array.from(
        { length: MAX_REVIEW_FILES + 1 },
        (_, index) => `lib/generated-review-${index}.ts`,
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
      Array.from(
        { length: MAX_REVIEW_FILES + 1 },
        (_, index) => `app/feature-${index}.ts`,
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
    const shards = Array.from(
      { length: MAX_REVIEW_FILES + 1 },
      (_, index) =>
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

  it("keeps deleted generated paths in the changed-file report", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();

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
        "data/generated/venues.json",
      ]);
      expect(
        summarizeReviewScope(changedFilesFromGit(base, head, repo)).forbidden,
      ).toEqual([
        { category: "generated", path: "data/generated/venues.json" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses an empty-tree diff for an all-zero base SHA", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-zero-base-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();

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
      expect(files).toEqual(["public/data/venues_slim.json"]);
      expect(summarizeReviewScope(files).ok).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("local review scope", () => {
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  function write(path: string, content = "changed\n") {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  const script = join(process.cwd(), "scripts/check_review_scope.mjs");

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "pubmax-local-review-"));
    git("init", "-q");
    git("config", "user.name", "Review Scope Test");
    git("config", "user.email", "review-scope@example.invalid");
    write("README.md", "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it.each([
    "committed-restored",
    "staged-removed",
    "unstaged-generator",
    "staged-generator",
  ])("refuses forbidden content hidden by %s", (caseName) => {
    const output = "public/data/uk_base/manifest.json";
    if (caseName !== "staged-removed") {
      write(output, "{}\n");
      git("add", ".");
      git("commit", "-qm", "base generated data");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
    }
    write(output, '{"forbidden":true}\n');
    git("add", output);
    if (caseName === "staged-removed") rmSync(join(repo, output));
    else {
      git("commit", "-qm", "generated-only edit");
      if (caseName === "committed-restored") write(output, "{}\n");
      else {
        write("scripts/build_uk_base_shards.mjs");
        if (caseName === "staged-generator")
          git("add", "scripts/build_uk_base_shards.mjs");
      }
    }
    const result = spawnSync(
      process.execPath,
      [script, "--local", "--repo", repo],
      { encoding: "utf8" },
    );
    const report = JSON.parse(result.stdout);
    expect(result.status).toBe(1);
    expect(report.categories.generated).toContain(output);
    expect(report.forbidden).toContainEqual({
      category: "generated",
      path: output,
    });
  });

  it("does not let an unstaged generator excuse staged generated output", () => {
    write("public/data/uk_base/manifest.json", "{}\n");
    git("add", "public/data/uk_base/manifest.json");
    write("scripts/build_uk_base_shards.mjs");
    const result = spawnSync(
      process.execPath,
      [script, "--local", "--repo", repo],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
  });

  it("permits a generator and its output staged together", () => {
    write("scripts/build_uk_base_shards.mjs");
    write("public/data/uk_base/manifest.json", "{}\n");
    git("add", ".");
    const result = spawnSync(
      process.execPath,
      [script, "--local", "--repo", repo],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).categories.regenerated).toEqual([
      "public/data/uk_base/manifest.json",
    ]);
  });

  it("refuses staged output after its committed generator is reverted in the index", () => {
    write("scripts/build_uk_base_shards.mjs");
    write("public/data/uk_base/manifest.json", "{}\n");
    git("add", ".");
    git("commit", "-qm", "generator and output");
    git("rm", "scripts/build_uk_base_shards.mjs");
    const result = spawnSync(
      process.execPath,
      [script, "--local", "--repo", repo],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
  });

  it.each(["HEAD", "index", "worktree"])(
    "keeps a forbidden type change in %s",
    (state) => {
      const output = "public/data/uk_base/manifest.json";
      write(output, "{}\n");
      git("add", ".");
      git("commit", "-qm", "base generated file");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      rmSync(join(repo, output));
      symlinkSync("../../../README.md", join(repo, output));
      if (state !== "worktree") git("add", output);
      if (state === "HEAD") {
        git("commit", "-qm", "generated symlink");
        expect(changedFilesFromGit("origin/main", "HEAD", repo)).toContain(
          output,
        );
      }
      const result = spawnSync(
        process.execPath,
        [script, "--local", "--repo", repo],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).forbidden).toContainEqual({
        category: "generated",
        path: output,
      });
    },
  );

  it.each(["HEAD", "index"])(
    "keeps the forbidden source of a rename in %s",
    (state) => {
      write("skills/example/SKILL.md", "source content\n");
      git("add", ".");
      git("commit", "-qm", "base skill file");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      mkdirSync(join(repo, "docs"));
      renameSync(
        join(repo, "skills/example/SKILL.md"),
        join(repo, "docs/example.md"),
      );
      git("add", ".");
      if (state === "HEAD") {
        git("commit", "-qm", "rename skill file");
        expect(changedFilesFromGit("origin/main", "HEAD", repo)).toEqual([
          "docs/example.md",
          "skills/example/SKILL.md",
        ]);
      }
      const result = spawnSync(
        process.execPath,
        [script, "--local", "--repo", repo],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).forbidden).toContainEqual({
        category: "skill-pack",
        path: "skills/example/SKILL.md",
      });
      expect(JSON.parse(result.stdout).categories.docs).toContain(
        "docs/example.md",
      );
    },
  );

  it("runs the guard when the CLI path is a symlink", () => {
    write("public/data/uk_base/manifest.json", "{}\n");
    const linkedScript = join(repo, "review-scope-link.mjs");
    symlinkSync(script, linkedScript);
    const result = spawnSync(
      process.execPath,
      [linkedScript, "--local", "--repo", repo],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).forbidden).toContainEqual({
      category: "generated",
      path: "public/data/uk_base/manifest.json",
    });
  });

  it("keeps imports inert when argv does not identify an executable file", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const script = process.argv[1]; process.argv[1] = 'missing-entry.mjs'; await import(script);",
        script,
      ],
      { cwd: repo, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("returns an empty review for a clean base checkout", () => {
    expect(localChangesFromGit(repo)).toEqual({
      base: git("rev-parse", "HEAD"),
      files: [],
      unexplainedGeneratedPaths: [],
    });
  });

  it("keeps an earlier generator commit beside later local generated output", () => {
    write("scripts/build_uk_base_shards.mjs");
    git("add", ".");
    git("commit", "-qm", "generator change");
    write("public/data/uk_base/manifest.json", "{}\n");
    git("add", ".");
    git("commit", "-qm", "generated output");
    write("public/data/uk_base/manifest.json", '{"new":true}\n');
    write("docs/proof/local/receipt.json", "{}\n");
    const report = JSON.parse(
      execFileSync(process.execPath, [script, "--local", "--repo", repo], {
        encoding: "utf8",
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.head).toBe("working-tree");
    expect(report.categories).toEqual({
      source: ["scripts/build_uk_base_shards.mjs"],
      regenerated: ["public/data/uk_base/manifest.json"],
      evidence: ["docs/proof/local/receipt.json"],
    });
  });

  it("includes committed, staged, unstaged, deleted and untracked paths", () => {
    write("lib/committed.ts");
    git("add", ".");
    git("commit", "-qm", "branch source");
    write("lib/staged.ts");
    git("add", "lib/staged.ts");
    write("lib/committed.ts", "local change\n");
    rmSync(join(repo, "README.md"));
    write("skills/untracked/SKILL.md");
    write(".gitignore", "ignored/\n");
    write("ignored/local.txt");
    expect(localChangesFromGit(repo).files).toEqual([
      ".gitignore",
      "README.md",
      "lib/committed.ts",
      "lib/staged.ts",
      "skills/untracked/SKILL.md",
    ]);
    expect(
      summarizeReviewScope(localChangesFromGit(repo).files).forbidden,
    ).toEqual([{ category: "skill-pack", path: "skills/untracked/SKILL.md" }]);
    expect(() =>
      execFileSync(process.execPath, [script, "--local", "--repo", repo], {
        stdio: "pipe",
      }),
    ).toThrow(expect.objectContaining({ status: 1 }));
  });

  it("refuses unexplained generated output", () => {
    write("public/data/uk_base/manifest.json", "{}\n");
    const report = summarizeReviewScope(localChangesFromGit(repo).files);
    expect(report.forbidden).toEqual([
      { category: "generated", path: "public/data/uk_base/manifest.json" },
    ]);
  });

  it("uses the common ancestor when origin/main has advanced independently", () => {
    const base = git("rev-parse", "HEAD");
    write("lib/branch.ts");
    git("add", ".");
    git("commit", "-qm", "branch change");
    const head = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", base);
    write("lib/main-only.ts");
    git("add", ".");
    git("commit", "-qm", "main change");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "--detach", head);
    expect(localChangesFromGit(repo)).toEqual({
      base,
      files: ["lib/branch.ts"],
      unexplainedGeneratedPaths: [],
    });
  });

  it("fails clearly when local base history is absent", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    expect(() => localChangesFromGit(repo)).toThrow(
      "Local review needs origin/main and shared history",
    );
    expect(() =>
      execFileSync(process.execPath, [script, "--local", "--repo", repo], {
        stdio: "pipe",
      }),
    ).toThrow(expect.objectContaining({ status: 2 }));
  });

  it("refuses conflicting local and explicit revision arguments", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [script, "--local", "--base", "HEAD", "--head", "HEAD", "--repo", repo],
        { stdio: "pipe" },
      ),
    ).toThrow(expect.objectContaining({ status: 2 }));
  });
});
