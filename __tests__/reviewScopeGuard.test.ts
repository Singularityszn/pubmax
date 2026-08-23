import { describe, expect, it } from "vitest";

import {
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
    expect(report.domains).toEqual(["app", "lib", "supabase"]);
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
});
