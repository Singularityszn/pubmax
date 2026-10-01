# R24 review: three R23 E2E repairs

Scope: source-only review of `e2e/desktop-map-chrome-fit.spec.ts`,
`e2e/landmark-and-sheet.spec.ts`, and `e2e/mobile-discover-coverage.spec.ts`.
No tests or browser runs performed in this review.

## Findings

- **Desktop drawer exchange does not weaken the motion assertions.** The R23
  failure was the venue drawer sampled at `x=785.6`, after the planner drawer
  had already crossed; the old polling path allowed real work to skip the
  intended frame. The new loop advances one 16 ms fake frame at a time, requires
  a planner crossing, keeps the venue geometry window, checks aria-hidden state
  and mounted Inspector, and still checks settled ownership, retargeting, and
  Back restoration. `lib/useSpringValue.ts` schedules its spring on
  `requestAnimationFrame`, which `page.clock.runFor(16)` advances. Source change
  is aligned to observed failure.

- **Responsive close now samples retained content before advancing the spring.**
  The R23 failure waited for `.venueInspector` to count as one after clicking;
  on the 900 px close it was already gone, so the retry could miss the brief
  retained-child phase. The new helper pauses, clicks the same SurfaceNav
  control, asserts the drawer is hidden while its Inspector remains, then steps
  frames until content unmounts and checks the final off-screen position. This
  preserves the intended content-lifetime assertion. The helper itself does
  not record an intermediate x/y displacement, so it cannot alone prove that
  the spring visibly moved before unmount. Existing sibling tests in the same
  spec already sample per-frame position and require over 10 px displacement
  for both axes at 700 and 900 px, then require drawer-header removal. Combined suite
  coverage includes the motion phase; keep this helper's evidence scoped to
  content lifetime and final position.

- **Discover locator now targets the visible accessible region.** The R23
  artifact shows `.nightAreaCoverage` matching two nodes, one hidden and one
  visible, causing strict-mode failure before content assertions. Exact
  `getByRole("region", { name: "Where you can plan a crawl tonight" })` resolves
  the user-visible named region and keeps the original heading, evidence copy,
  category states, links, and overflow assertions scoped beneath it. Strict
  role matching still rejects multiple visible regions with that name. It does
  not prove the hidden DOM copy or duplicate ID was removed; treat it as a
  locator correction, not a product duplicate-removal fix.

## Clock semantics

Clock placement and `runFor` usage are appropriate for this RAF-driven spring:
the clock is installed before navigation, content is allowed to load, and fake
frames advance the actual spring callbacks. One narrow side effect remains:
`pauseAt(Date.now() + 60_000)` jumps fake browser time forward by a minute before
pausing, and Playwright fires due timers at most once during that jump. This is
not a false assertion by itself, and the same idiom appears in adjacent drawer
tests, but it can trigger unrelated app timers or time-derived state. If the
goal is only to freeze motion, pausing at the current fake time avoids that
unneeded one-minute advance.

## Evidence boundary

Parent reports the focused seven-case run passed with the controlled clock.
This review did not rerun it. The archived R23 full run remains historical
evidence (`1284 PASS, 5 FAIL`) until the current full gate completes.
