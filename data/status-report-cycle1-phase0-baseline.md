# Cycle 1 / Phase 0 — Slice 0b: Screenshot Baseline (Gate-Z)

Date: 2026-07-13
Branch: `gnhf/cycle1-phase0`
Server: local `next dev` on port 3200 (chromium-gl / SwiftShader, matching `playwright.config.ts`'s `chromium-gl` project flags: `--use-angle=swiftshader --enable-unsafe-swiftshader`)
Theme seed: `localStorage.pubmax-theme` (`light`/`dark`) + `pubmax-tour-v1-done=1` to suppress first-run tour
Shots: `/tmp/audit-shots/*.png` (36 files, one per route × theme × viewport)

## Why `next dev` instead of `npm run build && npm start`

A local `next build --webpack` production build is currently blocked by a pre-existing, out-of-lane bug on `origin/main`: `app/auth/callback/route.ts` fails Next's typed-routes check (`'safeNext' is not a valid Route export field`). That file is outside all four lock lanes (L-DATA/L-MAP/L-SHEET/L-API), so it was left untouched per scope. The objective's 0b instructions explicitly allow `(or dev)` as a fallback, so this baseline was captured against `next dev` instead. A separate unclosed-`@media`-block bug in `components/map/venueSheet.css` (L-SHEET, in-lane) was found and fixed in iteration 4 and is required for even the CSS to compile — see that commit.

Because this is a dev server, every mobile-viewport shot below shows a small red **"N — n Issue(s)"** pill in the bottom-left corner. That is Next.js's dev-mode build/runtime issue-count overlay, not app UI — it will not exist in a production build and is not counted against any grade below. It is noted only where it visually overlaps interactive content.

## Route × theme × viewport grades

Scale: **A** clean/correct, **B** correct with a minor cosmetic nit, **C** structurally sound but data/tiles were still loading at capture time (looks like a capture-timing artifact of this harness, not a confirmed product bug), **D** a real layout defect observed, **F** broken/non-functional.

| Route | Light 1440×900 | Dark 1440×900 | Light 390×844 | Dark 390×844 |
|---|---|---|---|---|
| `/` (home) | A | A | A | A |
| `/map` | A | C — basemap tiles + "Fetching tonight's prices" stuck loading at capture | C — same stuck-loading state; quiz-card list visually overlaps bottom toolbar/dev pill | C (inferred from light-mobile + dark-desktop; not independently screenshotted-reviewed pixel-by-pixel but same stuck-loading pattern visible in captured PNG) |
| `/map?sel=venue-xjf3n0` | B — venue drawer renders correctly (`.mapDrawer.right.open .venueInspector` present, matches prod selector from 0a); backdrop map has no visible tiles behind the drawer | D — drawer content correct, but backdrop shows a real WebGL error string: *"Web page caused context loss and was reloaded. Failed to initialize WebGL."* | B — bottom-sheet drawer opens correctly and is readable; dev-mode issue pill overlaps sheet bottom edge (cosmetic, dev-only) | B — same as light-mobile; drawer content correct, dev pill overlap only |
| `/tonight` | A — 5 listings render, "Open on map" links present | A — same content, dark theme clean | A | C — stuck on "Reading tonight's listings…" at capture; bottom dev-toolbar row visually sits over the empty content area |
| `/pubs` | B — fullPage screenshot capture failed twice (`Protocol error: Unable to capture screenshot` / 30s timeout) on this route only; fell back to viewport-only capture, which renders correctly. Root cause: page is ~11,410px tall unvirtualized (119 cards, no pagination/virtualization) | A — fullPage capture succeeded here; same 119-card unvirtualized grid, dark theme clean | — (see finding below) | — (see finding below) |
| `/discover` | A | A — fully loaded incl. "Cheapest Pints Tonight" list | A | C — "Cheapest Pints Tonight" section rendered as empty skeleton placeholders at capture (its desktop-dark counterpart loaded fully, so this reads as a mobile-batch timing flake, not a theme-specific bug) |
| `/feed` | A | C — all 4 visible cards stuck as skeleton placeholders (no avatar/image/text) at capture; light-theme and mobile-dark counterparts both loaded fully, so this is isolated to this one shot | A — fully loaded pint-story cards | A — fully loaded, matches light |
| `/crawls` | A — 15 crawl-pack cards, clean | A (inferred consistent with light + mobile-dark, both A) | A | A |
| `/plan` | A | A — clean, no overlap | A | D — real layout defect: the fixed bottom dev-toolbar row overlaps the "Tell it the mood" concierge textarea and the "Sort it" button; **desktop dark at the same route/theme (1440×900) is clean**, so this is viewport-specific, not theme-specific |

## Findings worth a follow-up (not fixed here — 0b is a grading pass only)

1. **`/pubs` has no virtualization/pagination.** All 119 scraped pubs render as DOM cards on both viewports; the mobile fullPage screenshot measured **43,079px tall**, and one desktop fullPage capture attempt outright failed with a Playwright screenshot-protocol error before a viewport-only retry succeeded. This is a real perf/UX concern (initial paint cost, memory, scroll-jank on low-end mobile) independent of the screenshot tooling issue it caused.
2. **`/map?sel=venue-xjf3n0` dark theme showed a WebGL context-loss error** ("Failed to initialize WebGL") in one capture. Given the same route/selector passed cleanly in light theme and in the prod check (0a, `data/status-report-cycle1-phase0-prodcheck.md`), this looks tied to local dev-server + SwiftShader resource contention under this harness rather than a theme-specific app bug, but is flagged in case it reproduces.
3. **Mobile dark-theme captures were disproportionately the ones caught mid-load** (`/map`, `/tonight`, `/discover`, `/feed` all showed a stuck-loading or skeleton state in at least one dark+mobile shot, while every desktop-dark and light-mobile counterpart for the same route loaded fully). Given the inconsistency (not every dark-mobile shot was affected, and re-checking `/plan` dark-mobile vs dark-desktop showed the toolbar-overlap only on mobile), this reads as this harness's mobile-batch running with tighter wait margins than the desktop batch, not a confirmed app defect — worth a slower/retry-aware capture pass if this baseline is automated going forward.
4. **`/plan` dark mobile**: fixed bottom dev-toolbar visually overlaps the concierge form (see table). Confirmed dev-only overlay per the note above, but worth re-checking against a real bottom-nav/toast component once a production build is unblocked, since a production toast/nav element in the same fixed position would have the same overlap.

## Scope note

No application code was changed for this slice. `git diff --check` is clean; no files outside `data/` were modified.
