# Claude handoff: PUBMAXX price evidence mission wave

Generated: 15 August 2026

## Purpose

Continue PUBMAXX from the current product-loop authority, preserve the existing
competitive-research evidence, and build a London-wide price evidence mission
loop. This document is an index and decision record. Follow the linked source
artifacts instead of restating or replacing them.

## Standing delivery rule

Completed work must be committed and pushed to GitHub before handoff. A clean
local worktree alone is not delivery. Do not open a pull request unless the user
asks for one.

## Authority map

### Product implementation

- Repository: `$HOME/Documents/pubmax`
- Authoritative worktree: `$HOME/.codex/worktrees/pubmax-product-loop`
- Branch: `codex/current-main-product-loop`
- Commit: `39fe6a48b2d5816744ef22dc6075037f8e20dbdd`
- Fresh status check: clean, 47 commits ahead and 3 commits behind
  `origin/main` after `git fetch --prune origin`.
- Remote warning: `git ls-remote` found no remote
  `codex/current-main-product-loop` branch. These 47 commits are local-only.
- Exact branch inventory:

  ```bash
  git -C "$HOME/.codex/worktrees/pubmax-product-loop" \
    log --oneline origin/main..codex/current-main-product-loop
  ```

Do not use the main checkout as an implementation worktree. It contains many
unrelated tracked and untracked changes. Preserve them.

### Competitive research

- Repository: `$HOME/Documents/pubmaxxing-cheapestpint-research-live`
- Branch: `codex/cheapestpint-live-research`
- Commit: `28f5d70`
- Primary report:
  `$HOME/Documents/pubmaxxing-cheapestpint-research-live/.lavish/cheapestpint-competitive-report.html`
- Findings:
  `$HOME/Documents/pubmaxxing-cheapestpint-research-live/outputs/deep_competitive_findings.md`
- Latest public refresh:
  `$HOME/Documents/pubmaxxing-cheapestpint-research-live/outputs/live_refresh_2026-08-15.md`
- Evidence gaps:
  `$HOME/Documents/pubmaxxing-cheapestpint-research-live/outputs/evidence_gaps.md`
- Attachment audit:
  `$HOME/Documents/pubmax/docs/research/cheapestpint-attachment-audit.md`

Research worktree is intentionally dirty. Preserve modified manifest/report
files and untracked evidence captures from 14 and 15 August. Do not reset,
clean, rewrite, or import those files into PUBMAXX.

## Implemented product state

Use the exact Git log above for all 47 branch-unique commits. Main implemented
themes are:

1. Permanent one-tap acquisition and Venue acceptance
   - `611597822` makes `Find my pint` the permanent nearby entry.
   - `37a9f455` makes explicit Venue acceptance permanent.
   - `32e8a1ff1` publishes governed Night Area Pint Price pages.
   - `8eee75aef` keeps phone Venue tabs touch-scrollable.
   - Plans:
     `docs/superpowers/plans/2026-08-14-permanent-one-tap-landing.md` and
     `docs/superpowers/plans/2026-08-15-governed-night-area-landings.md` in the
     authoritative product worktree.

2. Governed search acquisition
   - Drink-brand Pint Price pages are governed, published, indexed, and covered
     by browser proof. Commit series starts at `a1362a787` and ends at
     `a1c834e19`.
   - Brand-by-area Pint Price pages use one governed assignment, price-row,
     publisher, sitemap, and contribution contract. Commit series starts at
     `8d47b2b9a` and ends at `9c3011c12`.
   - Specifications:
     `specs/governed-brand-area-pint-landings.md` and
     `docs/superpowers/plans/2026-08-15-governed-drink-brand-landings.md`.
   - Proof: `docs/proof/drink-brand-landing/` and
     `docs/proof/night-area-landing/`.

3. Root mobile action hierarchy
   - `c07905b85` removes root mobile tab chrome so `Find my pint` owns the first
     action. `d1c234c4a` pins footer and tab-clearance behavior.
   - Specification: `specs/root-landing-mobile-primary-action.md`.

4. Price contribution to personal impact
   - Credited Community Price receipts link to
     `/u/<handle>#contribution-impact`.
   - Late identity mounting, once-only fragment scrolling, and signed-account
     claim-nudge honesty are covered through `57dcb3d2a` to `d9f3f26f7`.
   - Specification: `specs/price-contribution-impact-destination.md`.

5. Honest post-value identity nudge
   - Email action is real magic-link sign-in. Inactive digest promises and
     subscriber writes are absent. Focus containment and email wording were
     corrected through `7af2f39c9`, `2dd77f52c`, and `7d431e3f6`.
   - Specification: `specs/honest-identity-nudge-email-action.md`.

6. Mobile invite RSVP to Map
   - `39fe6a48b` gives a guest one Map continuation only after a valid Going or
     Maybe response. It preserves Crawl Stop order, supports one or many valid
     Venue IDs, keeps failure inline, and announces success.
   - Specification: `specs/mobile-invite-rsvp-map-handoff.md`.
   - Plan: `docs/superpowers/plans/2026-08-15-mobile-invite-rsvp-map-handoff.md`.
   - Proof: `docs/proof/mobile-invite-map-handoff/`.

### Recorded verification

Latest product-loop closeout recorded these results before this handoff:

- `npm run verify`: pass, including 10,569 Vitest tests.
- Mobile invite production Playwright: 8 of 8 pass.
- Final Next production build: pass, 522 pages.
- Product worktree: clean at the commit named above.

These are prior closeout results, not a new run from this documentation-only
branch. Re-run checks that cover any next change.

### Known caveats

- Product authority is not rebased or merged with the three newer `origin/main`
  commits. Reconcile those commits in the next feature branch.
- Final invite review flagged possible visual-proof drift after the focus-ring
  treatment changed. Re-run the documented proof command and inspect
  `invite-map-focus-390-light.png` before treating that image as current.
- A Clerk development keyless/CSP mismatch was diagnosed in another dirty
  checkout, but no committed fix belongs to this product authority. Do not
  describe it as implemented.

## Competitive evidence boundary

Current public research supports product comparison, not database reuse.

- Latest 15 August refresh records 1,043 contributions, 4,978 public Pint Price
  rows, 82 manual Venue rows, and 830 sitemap routes.
- Contribution totals are not unique-user totals. No public unique-user count
  was found.
- No dedicated public comment surface, contributor-account field, or public
  contributor profile was found.
- iOS and Android beta recruitment is visible. A public App Store or Play Store
  release remains unverified.
- Attachment hashes pass, but the original package contains only 25 derived
  Pint Price rows. It does not contain a complete competitor payload, users,
  comments, raw captures, or a native application artifact.
- Public chronology contradicts a simple claim that Cheapest Pint copied
  PUBMAXX. Do not repeat that allegation without new dated evidence.
- `/ws` was excluded. No login, CAPTCHA, access control, rate limit, or private
  surface was bypassed. Do not test or use any exposed credential-shaped value
  observed in public JavaScript.

Use competitor research to copy speed and clarity only. Do not copy records,
prose, images, rankings, contributor data, or source code.

## Approved next wave: price evidence missions

Goal: increase trusted Community Price supply through one useful task at a
time, without weakening PUBMAXX identity, Provenance, privacy, or Map authority.

### Slice 1: mission discovery

- Launch London-wide for signed-in Pubmaxxers only.
- Support every category in `SUBMITTABLE_DRINK_CATEGORIES`.
- Show one ranked mission above normal `/near` results.
- In Map, show a mission only inside the selected eligible Venue sheet. Add no
  floating Map chrome.
- Rank a current provisional category first, an expired category second, then a
  Venue with no Community Price observations.
- Provisional and stale missions name the exact drink category. A missing
  mission lets the contributor choose any submittable category.
- Use a blank price input. Do not prefill or provide one-tap agreement.
- No reservation or durable claim. Dismissal lasts only for current browser
  session.
- Use already ranked Venue IDs. Never send or store viewer coordinates.

### Slice 2: evidence submission

- Reuse the existing Venue submission surface and authoritative
  `/api/price-submit` path.
- Preserve Venue ID, category when known, mission reason, and exact return
  surface.
- Keep the user on current surface after a failed write.
- Receipt must come from authoritative read-back. It can say the observation
  was logged, that the price is trusted now, or that another independent check
  is still needed. It must never infer trust from client mission state.
- Community Price trust stays two independent actors, at most 30 days old, and
  within the existing wider-of-50p-or-10-percent agreement window.
- Categories excluded from Map lenses can improve the Venue page but must not
  claim Map impact.

### Slice 3: personal impact

- Extend the existing personal contributions card. Do not add a leaderboard or
  a separate mission page.
- Show observations logged, prices trusted now, and lifetime trust unlocks as
  separate measures.
- Credit every independent contributor in the first qualifying threshold
  cluster. A later agreeing report does not earn the same unlock again.
- Bind credit to stable PUBMAXX User ID ownership, never mutable handle text.
- A moderator-hidden source observation revokes visible lifetime credit but
  keeps an immutable audit reversal. If remaining evidence still qualifies,
  create one deterministic replacement trust event.

## Required interfaces and safeguards

- Add one bounded, authenticated mission read using Venue IDs only. Response
  must distinguish `ready` from `degraded` and must not turn a failed read into
  an empty market claim.
- Candidate DTO needs Venue ID, reason (`provisional`, `stale`, or `missing`),
  optional drink category, and optional observation date. It needs no price,
  handle, or coordinates.
- Derive ranking and trust from existing Community Price store rows and policy.
  Do not add a parallel trust definition.
- Add service-role-only trust-event and trust-credit persistence. Browser roles
  receive no direct read or write privilege. Ship SQL only. Captain applies
  migrations.
- Make event creation concurrency-safe and idempotent through a deterministic
  evidence fingerprint and database uniqueness.
- Update `/privacy` in the same change because durable trust milestones and
  audit reversals become a new account-linked data practice.
- Add consent-gated closed analytics for mission viewed, opened, dismissed,
  submitted, newly trusted, and impact opened. Properties may contain only
  surface, reason, category, and outcome. No Venue ID, handle, price, coordinate,
  or free text.

Primary measures:

1. Mission view to valid submission conversion.
2. Share of valid mission submissions that create newly trusted evidence.

## Next-session start

1. Read repository `AGENTS.md`, every `CONTEXT.md`, `docs/VOICE.md`, this file,
   and linked product specifications.
2. Preserve both dirty worktrees described above.
3. Create `codex/price-evidence-missions` from
   `codex/current-main-product-loop` in a new worktree.
4. Merge latest `origin/main` into that feature branch. Do not rewrite the
   product-loop branch history.
5. Write one approved feature specification that closes API shapes, trust-event
   schema, response states, and three independently verifiable slices.
6. Implement with test-driven development. Start each behavior with a failing
   test, then run focused checks before full gates.
7. Test ranking, all categories, authentication, bounds, degraded reads,
   concurrent unlocks, moderation reversal, handle rename, submission failure,
   analytics minimisation, keyboard focus, and 320/390/430 px geometry.
8. Run focused tests, `npm run verify`, isolated production Playwright, final
   build, `git diff --check`, and visual proof review.
9. Commit and push `codex/price-evidence-missions`. Verify remote branch exists.
   Do not open a pull request unless the user asks.

## Suggested skills

- `grilling` only if a new product decision appears. Current mission decisions
  are closed.
- `writing-plans` and `write-spec` before implementation.
- `domain-modeling` for mission, trust event, credit, and reversal vocabulary.
- `using-git-worktrees` to isolate the feature from dirty checkouts.
- `test-driven-development` for every slice.
- `api-and-interface-design` for bounded mission reads and receipt states.
- `supabase-postgres-best-practices` for event uniqueness, RLS, and indexes.
- `accessibility`, `anti-ui-slop`, and `playwright` for mobile proof.
- `requesting-code-review`, `review`, `check-work`, and
  `verification-before-completion` before push.

## Out of scope for this handoff branch

This branch adds documentation only. It does not implement price missions,
change product code, apply a database migration, import competitor data, modify
either dirty worktree, or open a pull request.
