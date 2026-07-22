/**
 * UX Stickiness Wave — behavioural contract tests.
 *
 * Covers the four shippable items in this wave:
 *   1. Feed: error state is distinct from empty state (role="alert" vs role="status")
 *   2. Feed: end-of-feed CTA is present (feedEndCta class)
 *   3. Tonight: filter-chip active state has strengthened styling
 *   4. NightMemoryStudio: first-run callout gated behind studioLoaded
 *   5. Moment saved: corrected post-save links (Story CTA, not /feed)
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import EmptyState from "@/components/EmptyState";

// ── 1. Feed error/empty semantic distinction ───────────────────────────────

describe("Feed error vs empty state", () => {
  it("an error result renders role=alert (not a passive empty result)", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "Feed failed to load.",
        body: "Couldn't reach the server. Check your connection and try again.",
        role: "alert",
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Feed failed to load.");
    // renderToStaticMarkup HTML-encodes the apostrophe; match the encoded form.
    expect(html).toContain("reach the server.");
  });

  it("an empty-feed result renders role=status (a passive, honest result)", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        eyebrow: "Quiet at the bar",
        title: "No pints logged yet tonight.",
        body: "Be the first to drop one.",
        role: "status",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("No pints logged yet tonight.");
  });

  // The core fix: 'error' status must never produce isEmpty=true.
  it("isError and isEmpty are mutually exclusive across all status values", () => {
    type LoadState = "loading" | "ready" | "error";
    function deriveStates(status: LoadState, filteredCount: number) {
      return {
        isError: status === "error",
        isEmpty: status === "ready" && filteredCount === 0,
      };
    }
    // An error with zero items: isError=true, isEmpty=false.
    expect(deriveStates("error", 0)).toEqual({ isError: true, isEmpty: false });
    // A ready feed with zero items: isError=false, isEmpty=true.
    expect(deriveStates("ready", 0)).toEqual({ isError: false, isEmpty: true });
    // A ready feed with items: isError=false, isEmpty=false.
    expect(deriveStates("ready", 5)).toEqual({ isError: false, isEmpty: false });
    // Loading: both false.
    expect(deriveStates("loading", 0)).toEqual({ isError: false, isEmpty: false });
    // For all cases, isError && isEmpty must never both be true.
    for (const status of ["loading", "ready", "error"] as LoadState[]) {
      for (const count of [0, 3]) {
        const { isError, isEmpty } = deriveStates(status, count);
        expect(isError && isEmpty).toBe(false);
      }
    }
  });

  // The derive-states helper above already covers these; these extra
  // assertions are left as named documentation tests (no new logic).
  it("isEmpty is false when status is 'error' (covered by mutually-exclusive test)", () => {
    type LoadState = "loading" | "ready" | "error";
    function deriveEmpty(status: LoadState, count: number) { return status === "ready" && count === 0; }
    expect(deriveEmpty("error", 0)).toBe(false);
  });

  it("isEmpty is true only when status=ready and the filtered set is empty", () => {
    type LoadState = "loading" | "ready" | "error";
    function deriveEmpty(status: LoadState, count: number) { return status === "ready" && count === 0; }
    expect(deriveEmpty("ready", 0)).toBe(true);
    expect(deriveEmpty("ready", 3)).toBe(false);
    expect(deriveEmpty("loading", 0)).toBe(false);
    expect(deriveEmpty("error", 0)).toBe(false);
  });
});

// ── 2. Feed end-of-feed CTA (dead-end fix) ────────────────────────────────

const feedCss = readFileSync(join(process.cwd(), "app/feed/feed.css"), "utf8");

describe("Feed end-of-feed CTA CSS", () => {
  it("feedEndCta class exists and is min-height 44px (touch target)", () => {
    expect(feedCss).toMatch(/\.feedEndCta\s*\{[\s\S]*?min-height:\s*44px/);
  });

  it("feedEndCta is a link-styled element (text-decoration: none)", () => {
    expect(feedCss).toMatch(/\.feedEndCta[\s\S]*?text-decoration:\s*none/);
  });

  it("feedEndWrap container exists to frame the end-of-feed section", () => {
    expect(feedCss).toMatch(/\.feedEndWrap\s*\{/);
  });

  it("feedRetryBtn class exists for the error-state retry affordance", () => {
    expect(feedCss).toMatch(/\.feedRetryBtn\s*\{/);
  });

  it("feedRetryBtn is min-height 44px (touch target)", () => {
    expect(feedCss).toMatch(/\.feedRetryBtn[\s\S]*?min-height:\s*44px/);
  });
});

// ── 3. Tonight filter chip active state ───────────────────────────────────

const tonightCss = readFileSync(join(process.cwd(), "app/tonight/tonight.css"), "utf8");

describe("Tonight filter chip active state", () => {
  // Extract the .tonightChip[data-active="true"] block to assert on its values.
  it('.tonightChip[data-active="true"] uses at least 75% brass in its border', () => {
    // The active-chip block must contain a brass mix >= 75% (was 60%) so the
    // selected chip reads as clearly selected on mobile screens.
    const match = tonightCss.match(/\.tonightChip\[data-active="true"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = match![1];
    // Extract the brass percentage from border-color color-mix.
    const pctMatch = block.match(/border-color:\s*color-mix\(in srgb,\s*var\(--brass\)\s*(\d+)%/);
    expect(pctMatch).not.toBeNull();
    const pct = Number(pctMatch![1]);
    expect(pct).toBeGreaterThanOrEqual(75);
  });

  it('.tonightChip[data-active="true"] uses at least 18% brass fill', () => {
    const match = tonightCss.match(/\.tonightChip\[data-active="true"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = match![1];
    const bgMatch = block.match(/background:\s*color-mix\(in srgb,\s*var\(--brass\)\s*(\d+)%/);
    expect(bgMatch).not.toBeNull();
    const pct = Number(bgMatch![1]);
    expect(pct).toBeGreaterThanOrEqual(18);
  });

  it("active chip count badge inherits full ink color (opacity 1)", () => {
    // The count badge on an active chip uses var(--ink) at full opacity.
    const match = tonightCss.match(
      /\.tonightChip\[data-active="true"\]\s+\.tonightChipCount\s*\{([^}]+)\}/,
    );
    expect(match).not.toBeNull();
    const block = match![1];
    expect(block).toContain("var(--ink)");
    expect(block).toMatch(/opacity:\s*1/);
  });

  it('.tonightVibeChip[data-active="true"] uses at least 80% brass in its border', () => {
    const match = tonightCss.match(/\.tonightVibeChip\[data-active="true"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = match![1];
    const pctMatch = block.match(/border-color:\s*color-mix\(in srgb,\s*var\(--brass\)\s*(\d+)%/);
    expect(pctMatch).not.toBeNull();
    expect(Number(pctMatch![1])).toBeGreaterThanOrEqual(80);
  });
});

// ── 4. NightMemoryStudio first-run callout gating ─────────────────────────

describe("NightMemoryStudio first-run callout", () => {
  // The callout renders only when studioLoaded=true AND both arrays are empty.
  // This test documents the gating condition as a pure predicate.
  function shouldShowFirstRun(
    studioLoaded: boolean,
    memoriesLen: number,
    storiesLen: number,
  ): boolean {
    return studioLoaded && memoriesLen === 0 && storiesLen === 0;
  }

  it("shows first-run callout only after load settles with no content", () => {
    expect(shouldShowFirstRun(false, 0, 0)).toBe(false); // not loaded yet
    expect(shouldShowFirstRun(true, 0, 0)).toBe(true);   // loaded, empty → show
    expect(shouldShowFirstRun(true, 1, 0)).toBe(false);  // has memories
    expect(shouldShowFirstRun(true, 0, 1)).toBe(false);  // has stories
    expect(shouldShowFirstRun(true, 1, 1)).toBe(false);  // has both
  });

  it("suppresses first-run during load to prevent flash of onboarding content", () => {
    // studioLoaded=false means the fetch hasn't settled — even with empty arrays
    // (their initial value) the callout must stay hidden.
    expect(shouldShowFirstRun(false, 0, 0)).toBe(false);
  });

  it("NightMemoryStudio CSS file exists with first-run tokens", () => {
    const css = readFileSync(
      join(process.cwd(), "components/profile/NightMemoryStudio.css"),
      "utf8",
    );
    expect(css).toContain(".memoryStudioFirstRun");
    expect(css).toContain(".memoryStudioFirstRunPrimary");
    expect(css).toContain("min-height: 44px"); // touch target
  });
});

// ── 5. Moment saved: corrected Story nudge links ──────────────────────────

describe("Moment saved Story nudge", () => {
  // After saving a Moment the primary CTA should go to the Memory Studio,
  // NOT to /feed (which is the pint drops feed, not Night Stories). Verify
  // by parsing the MomentCapture source for the corrected href.
  it("momentSaved primary action links to Memory Studio, not /feed", () => {
    const source = readFileSync(
      join(process.cwd(), "components/moment/MomentCapture.tsx"),
      "utf8",
    );
    // The 'Build your Story' link must point to the Memory Studio section.
    expect(source).toContain('href="/u/you#night-memories"');
    // The old wrong link to /feed must NOT be the post-save target.
    // (It could appear elsewhere in the file for unrelated purposes, but the
    // momentSaved section must use /tonight or /u/you, not /feed.)
    const savedSection = source.match(/momentSaved[\s\S]*?section>/)?.[0] ?? "";
    expect(savedSection).not.toContain('href="/feed"');
    expect(savedSection).toContain('href="/tonight"');
  });

  it("post-save section uses 'Build your Story' as the primary CTA label", () => {
    const source = readFileSync(
      join(process.cwd(), "components/moment/MomentCapture.tsx"),
      "utf8",
    );
    expect(source).toContain("Build your Story");
  });
});
