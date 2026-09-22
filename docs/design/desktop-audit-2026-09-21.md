# Desktop audit — 21 September 2026

Audit for the firstmate desktop polish lane (`fm/pubmax-desktop-design-polish`). Viewports: **1440×900** and **1920×900** (dark on in-app routes where the product defaults to night-out chrome), plus **390×844** phone baselines for parity proof.

Screenshots live under [`screenshots/desktop-audit-2026-09-21-before/`](./screenshots/desktop-audit-2026-09-21-before/) (before) and [`screenshots/desktop-audit-2026-09-21-after/`](./screenshots/desktop-audit-2026-09-21-after/) (after this PR).

Reference comps: no Figma MCP or Mobbin session in this harness; direction follows `docs/DESIGN_SYSTEM.md`, `docs/DESIGN_DIRECTION_2026-07-18.md`, and `docs/PERSONA_DRINKS_AND_DESKTOP_PRD.md`. Named product comps: Citymapper (semantic lane colour), Linear (near-black chrome), Resy (stamp labels).

## Top ten (ranked)

| # | Finding | Routes | Fix in this PR |
| --- | --- | --- | --- |
| 1 | `/plan` describe-first column capped at 920px with a single stack, leaving wide dead gutters at 1440/1920 | `/plan` | Widen composer to `--content-max-wide`; two-column head + field from 1024px |
| 2 | `/social` signed-out keeps a third grid column for Activity even when `SocialContextRail` is absent | `/social` | `:not(:has(.socialContextRail))` two-column grid on desktop |
| 3 | Landing "What it saves you" reads as a narrow prose stack with empty paper beside it at 1920 | `/` | Two-column `lpWorth` grid from 1024px |
| 4 | Pint Drops rail stays a horizontal scroll on desktop though width allows a wrapped row | `/` | Three-up `dropStripRail` flex wrap from 1024px |
| 5 | Landing hero block not centred to `--content-max-wide` on very wide viewports | `/`, 1920 | `lpHero` width + auto margins from 1280px |
| 6 | Feed card lift/hover ran on coarse pointers (touch laptops) | `/feed` | Gate hover motion to `(hover: hover) and (pointer: fine)` + token durations |
| 7 | Map toolbar conditions chip had no hover acknowledgement | `/map` | Token hover on `.conditionsChip` (no transition: drawer rail timing) |
| 8 | Social lane tabs changed background with no transition | `/social` | `--duration-base` transitions on switcher links |
| 9 | Hard-coded 1240px on `.socialPage` instead of `--content-max-wide` | `/social` | Token swap |
| 10 | Plan example chips lacked hover transition parity with other controls | `/plan` | Chip transitions under desktop block |

## Route notes (unchanged positives)

- **Map** at 1440: toolbar + right rail composition matches D3.1; venue drawer geometry is fenced by `e2e/desktop-map-chrome-fit.spec.ts`.
- **Tonight** at 1100+: column + rail grid already addresses D8 empty-rail defect.
- **Feed** at 1024+: sticky filters rail + two-up stream uses `--content-max-wide`.

## Phone parity

All fixes sit in `@media (min-width: …)` or `(hover: hover) and (pointer: fine)` bands. Re-capture 390px before/after on the same routes in the PR body.
