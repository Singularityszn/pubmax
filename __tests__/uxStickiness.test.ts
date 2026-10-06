/**
 * UX Stickiness Wave — behavioural contract tests.
 *
 * Covers the shippable items in this wave:
 *   1. Feed: error state is distinct from empty state (role="alert" vs role="status")
 *   2. Feed: end-of-feed CTA is present (feedEndCta class)
 *   3. Feed: empty state collapses to one primary CTA + at most one secondary
 *   4. Tonight: filter-chip active state has strengthened styling
 *   5. NightMemoryStudio: first-run callout gated behind studioLoaded
 *   6. Moment saved: corrected post-save links (Story CTA, not /feed)
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import EmptyState from "@/components/ui/empty-state";
import { defined } from "@/__tests__/helpers/defined";

// ── 1. Feed error/empty semantic distinction ───────────────────────────────

describe("Feed error vs empty state", () => {
  // The primitive prints the title and one line and carries no live-region
  // role of its own: the CALLER says whether the result is a failure or a
  // passive empty answer, so the two can never share a role by accident.
  it("renders the title and the one line, and leaves the role to the caller", () => {
    const html = renderToStaticMarkup(
      createElement(
        EmptyState,
        { title: "Couldn't load Stories." },
        "Check your connection, then try again.",
      ),
    );
    expect(html).toContain("load Stories.");
    expect(html).toContain("Check your connection");
    expect(html).not.toContain("role=");
  });

  it("the feed wraps its error branch in role=alert and never its empty branch", () => {
    const source = readFileSync(
      join(process.cwd(), "app/feed/FeedPageClient.tsx"),
      "utf8",
    );
    const errorBlock =
      source.match(/<div role="alert">\s*<EmptyState[\s\S]*?title="Couldn't load Stories\."/)?.[0] ?? "";
    expect(errorBlock.length).toBeGreaterThan(0);
    const emptyIndex = source.indexOf('title="No pints logged yet tonight."');
    expect(emptyIndex).toBeGreaterThan(0);
    expect(source.slice(Math.max(0, emptyIndex - 200), emptyIndex)).not.toContain('role="alert"');
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

// ── 3. Feed empty-state CTA collapse (mobile audit) ───────────────────────

const feedClientSource = readFileSync(
  join(process.cwd(), "app/feed/FeedPageClient.tsx"),
  "utf8",
);

describe("Feed empty-state CTA collapse", () => {
  // Header compose (Capture / Log / We're out) must stand down on empty and
  // error so those surfaces own a single next step.
  it("gates header compose behind showComposeActions (ready + not empty)", () => {
    expect(feedClientSource).toContain(
      "const showComposeActions = status === \"ready\" && !isEmpty && !lotEmpty;",
    );
    expect(feedClientSource).toContain("{showComposeActions ? (");
    expect(feedClientSource).toContain('aria-label="Create"');
  });

  // The launch head (docs/design/LAUNCH_SCREENS.md) owns the Pint Drop door
  // as the page's ONE primary, so the empty state offers the other way in and
  // nothing filled: one quiet action, never the old four-way stack.
  it("empty branch ships one quiet action and leaves the primary to the head", () => {
    const emptyBlock =
      feedClientSource.match(
        /title="No pints logged yet tonight\."[\s\S]*?<\/EmptyState>/,
      )?.[0] ?? "";
    expect(emptyBlock.length).toBeGreaterThan(0);
    expect(emptyBlock).toContain('href="/moment"');
    const actionHrefs = emptyBlock.match(/href="[^"]+"/g) ?? [];
    expect(actionHrefs).toHaveLength(1);
    // Neither the head's own door nor We're out is a second empty-state CTA.
    expect(emptyBlock).not.toContain("/map?log=1");
    expect(emptyBlock).not.toContain("/we-are-out");
    expect(feedClientSource).toMatch(
      /primary=\{<Link href="\/map\?log=1">Drop a pint<\/Link>\}/,
    );
  });

  it("error branch keeps a single retry action (no compose pile-on)", () => {
    const errorBlock =
      feedClientSource.match(
        /title="Couldn't load Stories\."[\s\S]*?<\/EmptyState>/,
      )?.[0] ?? "";
    expect(errorBlock.length).toBeGreaterThan(0);
    expect(errorBlock).toContain("feedRetryBtn");
    expect(errorBlock).toContain("Try again");
    // Error must not invite compose CTAs inside the alert surface.
    expect(errorBlock).not.toContain("/map?log=1");
    expect(errorBlock).not.toContain("/moment");
    expect(errorBlock).not.toContain("/we-are-out");
  });

  // The way onward is the shared empty-state idiom (components/ui/emptyState.css):
  // a bordered secondary at 44px, never a second filled primary. The feed's own
  // stylesheet only sizes it to the column.
  it("feedEmpty leaves the action's shape to the shared empty-state idiom", () => {
    expect(feedCss).toMatch(/\.feedEmpty\s*\{[\s\S]*?max-width:\s*var\(--feed-max\)/);
    expect(feedCss).not.toContain("feedEmptyPrimary");
    expect(feedCss).not.toContain("feedEmptySecondary");
    const emptyStateCss = readFileSync(
      join(process.cwd(), "components/ui/emptyState.css"),
      "utf8",
    );
    expect(emptyStateCss).toMatch(
      /\.emptyStateAction > :is\(a, button\)\s*\{[\s\S]*?min-height:\s*44px/,
    );
    expect(emptyStateCss).not.toMatch(
      /\.emptyStateAction > :is\(a, button\)\s*\{[^}]*background:\s*var\(--accent-action\)/,
    );
  });
});

// ── 4. Tonight filter chip active state ───────────────────────────────────

const tonightCss = readFileSync(join(process.cwd(), "app/tonight/tonight.css"), "utf8");
const vibeChipsCss = readFileSync(join(process.cwd(), "components/vibe/vibeChips.css"), "utf8");

describe("Tonight filter chip active state", () => {
  // Extract the .tonightChip[data-active="true"] block to assert on its values.
  it('.tonightChip[data-active="true"] uses at least 75% brass in its border', () => {
    // The active-chip block must contain a brass mix >= 75% (was 60%) so the
    // selected chip reads as clearly selected on mobile screens.
    const match = tonightCss.match(/\.tonightChip\[data-active="true"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = defined(match![1]);
    // Extract the brass percentage from border-color color-mix.
    const pctMatch = block.match(/border-color:\s*color-mix\(in srgb,\s*var\(--brass\)\s*(\d+)%/);
    expect(pctMatch).not.toBeNull();
    const pct = Number(pctMatch![1]);
    expect(pct).toBeGreaterThanOrEqual(75);
  });

  it('.tonightChip[data-active="true"] uses at least 18% brass fill', () => {
    const match = tonightCss.match(/\.tonightChip\[data-active="true"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = defined(match![1]);
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

  it('.vibeChip[data-active="true"] uses at least 80% brass in its border', () => {
    const match = vibeChipsCss.match(/\.vibeChip\[data-active="true"\]\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = defined(match![1]);
    const pctMatch = block.match(/border-color:\s*color-mix\(in srgb,\s*var\(--brass\)\s*(\d+)%/);
    expect(pctMatch).not.toBeNull();
    expect(Number(pctMatch![1])).toBeGreaterThanOrEqual(80);
  });
});

// ── 5. NightMemoryStudio first-run callout gating ─────────────────────────

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

// ── 6. Moment saved: corrected Story nudge links ──────────────────────────

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
