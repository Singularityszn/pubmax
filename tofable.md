# Fable handoff: 5 August 2026

Snapshot time: 5 August 2026, after Social Task 5 completion and during early Task 6 work.

This file gives Fable one current coordination view of work completed today by Sol, Codex, Cursor, and repository automation. It separates merged work from pushed draft work and local-only work. It is a handoff, not proof that every merged commit is deployed.

## Read this first

- `origin/main` is `f78593a247506f7fc6e492fcd2a72ae2d0600f3f`.
- PR #726 is pushed and preview-verified. It is not merged. Production migration `0070` is its only recorded release gate.
- Social Night Loop Tasks 1 through 5 are complete on local branch `codex/social-night-loop-20260805`.
- Social branch is 16 commits ahead of `origin/main`. No Social commit is on a GitHub branch and no Social PR exists.
- Social Task 6 has started with uncommitted changes. Treat its current diff as unstable.
- Invite beta remains off. No Social migration has been applied to production.
- Primary checkout is dirty with work from several prior lanes. Do not reset, clean, stash, or bulk-commit it.

Status words in this handoff have strict meanings:

- **Merged**: commit is on `origin/main`.
- **Pushed**: commit exists on a GitHub branch or PR, but is not on `origin/main`.
- **Local commit**: commit exists only in a local branch.
- **Uncommitted**: working-tree change can still change or disappear.
- **Preview-verified**: named Vercel Preview and checks passed. This does not mean Production was promoted.

## Merged to `origin/main` today

These changes are on GitHub `main`. This snapshot did not independently prove their current Production deployment.

### RLS wave 2

Commit `6d2eefead` merged PR #714. It hardens browser access across the private data model and proves the effective policy and privilege result with local PostgreSQL and PostgREST. `AGENTS.md` owns the lasting RLS rules and rollback contract.

### Review-gated London data refresh

Commit `6adad3f3c` merged PR #721. Local refresh now follows a direct review-gated path and fails closed before publication. Operate this scheduler. Do not build another scheduler or control plane around it.

### Reserved PUBMAXX Handles

Commit `cb7fe486a` merged PR #712. Reserved names are protected across identity paths. PR #726 adds further release hardening, so use its final ownership rules after merge.

### Viewer-coordinate privacy and expiring rate limits

Commit `82f84bc44` merged PR #713. Viewer-coordinate egress is coarsened through the shared privacy seam. Durable rate-limit rows now expire rather than becoming an activity archive. `lib/geo.ts`, `/privacy`, and the related privacy tests remain one change boundary.

### Clerk provider availability

Commit `69b5b5aae` merged PR #722. When Clerk is fully configured, enabled social providers come from Clerk and sign-in uses Clerk. When Clerk is not configured, Supabase behaviour remains. A Clerk session is still not a PUBMAXX User ID.

### Dependency updates

PRs #716, #717, #718, #720, and #723 updated production and development dependencies. `origin/main` includes these updates through `f78593a24`.

## Pushed work that is not merged

### PR #724: design skills and plugin skill packs

Status: pushed draft, checks green, not merged.

This PR refreshes committed design skills, including Impeccable and Emil Kowalski motion skills. It also records machine-local global skill installation. Global skills are not repository content and will not follow a clone.

The personal starred-repository import remains blocked because the agent token cannot read `/user/starred`.

Ownership fence: `skills/` and the design-skill catalogue. Keep it separate from application and Social work.

### PR #725: full product, security, and UX review

Status: pushed draft, checks green, not merged.

Branch: `codex/full-review-20260805`.

Primary artifact: `docs/FABLE_FULL_PRODUCT_REVIEW_2026-08-05.md` on that branch.

The review covers all page templates on desktop and phone, security boundaries, data freshness, accessibility, build and test health, and current pint-price evidence. It is documentation only. Many original release blockers are already addressed by PR #726, so do not execute its Wave 0 list without comparing it to PR #726 first.

### PR #726: v1 release hardening

Status: pushed draft, preview-verified, not merged.

Branch: `codex/v1-release-20260805`.

Head: `0a9c8d4f8e9663067d2bf70929b28d9b130cd112`.

PR #726 closes the release blockers found by the product review:

- private Night Memory and Pub Pal voice quota authorisation
- atomic profile deletion and reserved-handle enforcement
- honest Night Crawl rollback when an action does not save
- dated, sourced, stale-aware menu prices
- build-time demo-content exclusion from public deployments
- durable reaction batching with honest rollback
- mobile Today clearance, Android install flow, early install-event retention, and Venue-tab reachability
- Clerk two-key gating and compact account controls
- stable coverage and repository quality gates under concurrent worktree load

Evidence already recorded on the PR:

- Linux Vercel Preview is Ready at exact head SHA.
- Remote Vercel `npm run ci` passed.
- Effective RLS passed.
- Local full CI passed 7,796 tests and the production build.
- Mobile obstruction browser proof passed at phone and desktop sizes.
- Preview runtime smoke found no errors.

Sole recorded release gate: Captain applies `supabase/migrations/20260805070000_0070_v1_release_security.sql`, verifies the ledger and ACL result, then marks PR ready. Use `docs/V1_RELEASE_HANDOFF_2026-08-05.md` on the PR branch for exact forward and rollback operations.

Do not merge PR #726 before migration `0070` is applied and verified. Do not apply later Social migrations first.

### Open dependency PRs #737 through #739

Status: pushed by Dependabot, open, not reviewed in this handoff.

- #737 proposes ESLint 10.
- #738 proposes TypeScript 7.
- #739 proposes Lucide React 1.28.

These are major tool or library jumps. Keep them outside PR #726 and Social integration. Review each against Next.js 16, lint configuration, TypeScript output, icons, full CI, and browser proof before merge.

## Sol and Codex Social Night Loop

Branch: `codex/social-night-loop-20260805`.

Worktree: `.codex-worktrees/social-night-loop-20260805`.

Status: 16 local commits, no remote branch, no PR. Tasks 1 through 5 are complete. Task 6 is active and uncommitted.

Canonical plan: `docs/superpowers/plans/2026-08-05-verified-social-night-loop.md` on the Social branch.

Detailed evidence: `.superpowers/sdd/2026-08-05-verified-social-night-loop/` on the Social branch.

### Task 1: beta contract and programme control

Status: local commits, complete, independently reviewed.

Delivered:

- verified invite-beta contract and threat model
- umbrella issue #728 and child issues #729 through #736
- real GitHub dependency edges between each delivery slice
- explicit release block until moderation primary and backup accept queue ownership, escalation, response duty, and handover proof

Policy sources: `docs/social/SOCIAL_BETA_CONTRACT.md` and `docs/social/SOCIAL_THREAT_MODEL.md`.

### Task 2: product identity and adult-verification policy

Status: local commits, complete after two review rounds.

Delivered:

- five-state Social access policy behind disabled beta flags
- stable product-account authority tied to PUBMAXX User ID and profile ownership
- atomic creation of an account-owned PUBMAXX Handle
- refusal of first-touch claims for generic, reserved, or already-owned profiles
- dual-session migration with deterministic account locks
- private, service-only assurance evidence storage
- fail-closed Social access route and exact proxy scope

Migration: `0071`. Captain has not applied it.

Yoti boundary: hosted provider work is not active. Social assurance code adds no date of birth, document, selfie, raw biometric payload, or estimated age. Existing private account identity keeps its separate required date-of-birth contract. A later provider integration needs official signed fixtures, replay protection, product-account binding, and matching legal changes.

### Task 3: durable verified Social posts

Status: local commits, complete after hardening and review.

Delivered:

- separate Social post aggregate for standard posts and feature requests
- public, friends, and private visibility with server-owned actor identity
- chronological Discover, Nearby, and Following feeds
- viewer-bound signed cursors and bounded page sizes
- recoverable removal and revision-aware edits
- OpenAI moderation with held state, bounded retry, terminal error handling, revision protection, and a protected cron worker
- keyless memory store and fail-closed durable Supabase store
- privacy, terms, and write-surface certification updates

Migration: `0072`. Apply after `0071`. Captain has not applied it.

Photo upload remains closed until Task 6 proves ownership, validation, moderation, and signed delivery.

### Task 4: interactions and governance

Status: local commit, complete and reviewed with no Critical or Important findings.

Delivered:

- Cheers, private saves, reposts, quote posts, comments, reports, blocks, and notifications
- idempotent desired-state writes and payload-bound idempotency keys
- author comment policy and transactional locking
- held moderation for comments and quote posts
- private saves with no count or notification
- chronological feeds and queues with viewer-bound cursors
- append-only feature-request status history
- reader reporting, named-moderator queue, hide and restore, and explicit resolution
- emergency freeze that still leaves reporting and moderation safety floors open

Migration: `0073`. Apply after `0072`. Captain has not applied it.

Protected Social web push remains deliberately unwired. Existing subscriptions are not bound strongly enough to stable verified profile ownership. In-app notifications are the current safe delivery path.

### Task 5: canonical Social shell

Status: local commits `638873cb8` and `4c465de3d`, complete and fully verified.

Delivered:

- canonical `/social` route with closed `tab`, `feed`, and listed Night Area state
- safe preview and verification boundaries that do not fetch protected posts
- chronological Following, Nearby, and Discover lanes with pagination
- mobile-first 44px controls and fixed-tab clearance at 320px, 390px, and 430px
- responsive desktop three-column layout
- bounded generic Activity rail that never prints protected source IDs or text
- canonical navigation, sitemap, analytics, warmup, route pattern, tracing, and internal links
- `/feed` and `/stories` redirects to `/social`
- `/discover` and `/drinks` redirects to `/social?tab=discover`
- malformed public DTOs cannot expose exact Venue context through the shell

Proof: `docs/proof/social-shell/README.md` on the Social branch.

Verification recorded 7,851 unit tests, focused tests, typecheck, lint, isolated production build, 11 Chromium tests, axe, keyboard, Back and refresh state, light and dark themes, and five viewport sizes.

### Task 6: active uncommitted work

Status: uncommitted and changing. Do not depend on it or edit the same files.

Current diff includes early post-contract, composer, media, and consent work:

- canonical pub Venue validation at the API boundary
- exact Venue projection only for the author or current mutual friends
- compare-and-swap revision required for all reader-visible edits
- moderation only for moderation-sensitive edits
- server-owned photo processing with type, byte, dimension, pixel, path, and ownership checks
- required photo alt text and private signed delivery
- consent-based photo tag proposals and append-only edit and moderation evidence
- rejection of caller-supplied media references outside the owned upload path

Task 6 still owns composer, media storage and delivery, tag consent, edits, draft recovery, and feature-request composition. Current work is not a completed feature claim.

Task 6 currently contains a draft migration named `0074_social_composer`. It is uncommitted. Do not apply it or allocate suffix `0074` to another lane while Task 6 is active. Confirm its final name and rollback only after Task 6 review.

## Uncommitted primary-checkout product work

Status: uncommitted, mixed ownership, not verified as one candidate, and not safe to ship from the primary checkout.

The primary diff contains product work beyond skill and documentation churn. Current tests and source show these intended corrections:

- Plan route mini-map clears stale reads when Crawl Stops change and fits routed detours as well as stop coordinates.
- Night Area coverage copy no longer turns missing non-price evidence into a Pint Price claim.
- Night mode distinguishes leave-by time and straight-line estimates.
- failed what's-on refresh returns unresolved state and does not stamp request time as a successful observation.
- TfL night-window calculation uses the correct boundary offset across the autumn clock change.
- mixed routed and straight walking geometry is labelled approximate, with a global limiter backstop when callers rotate forwarded addresses.
- Night Crawl blocks a second action after the final Crawl Stop.
- retired-handle profile metadata points to the current PUBMAXX Handle.
- desktop Moment return paths retain query-backed page state.
- profile deletion redaction covers both plain-name and handle mentions.
- Venue price-story reads clear stale state, ignore cancelled responses, and refresh after a confirmed price.

These changes may be valuable, but Git cannot prove one owner or one finished test cycle. Treat them as salvage candidates, not delivered features. Reproduce each defect in a clean worktree, compare it with PR #726 and Social ownership, then move only the verified slice.

Issue #727 and the uncommitted store and review-bloat specifications are architecture proposals only. No store deduplication feature is complete. Review dependency edges before turning that proposal into implementation lanes.

Critical migration collision: primary checkout contains untracked `supabase/migrations/20260805090000_0070_departed_contributor_name.sql`. PR #726 already owns release migration suffix `0070`. Do not apply or commit the untracked migration under that suffix. Reconcile its need after PR #726 merge, then assign a later unused migration number with matching rollback and tests.

## Contracts Fable must preserve

1. Clerk session and PUBMAXX User ID remain different identities. Product ownership always resolves through stable account authority.
2. Social beta flags stay off until release gates pass. Missing configuration must fail closed.
3. Committed Task 5 suppresses exact Venue context from public DTOs. Task 6 is testing a narrower author-or-mutual-friend projection. Do not depend on that wider projection until Task 6 commits and passes review.
4. Saves stay private. Engagement never controls feed order, Venue rank, map price authority, or paid reach.
5. Social content remains separate from Pint Drops, Visit Reports, Night Memories, and Night Stories. Each aggregate keeps its own consent and authority rules.
6. Moderation failure holds content. It never approves by default.
7. Social tables and functions remain service-role only with RLS enabled and browser grants revoked.
8. Any new data practice changes `/privacy` and `/terms` in the same commit.
9. Protected Social web push waits for stable subscription ownership and send-time visibility checks.
10. Captain applies production migrations. Stable required order is `0070`, `0071`, `0072`, then `0073`. Task 6 currently drafts `0074`, which is not ready to apply.

## Workspace and collision map

### Primary checkout

Path: `/Users/karanmanoharan/Documents/pubmax`.

Branch: `docs/dag-handoff`.

State at snapshot: 173 status entries from several previous lanes, including application code, tests, skills, docs, and migration work. Ownership is mixed and cannot be assigned safely from Git alone.

Rules:

- Do not reset, clean, stash, or bulk-stage this checkout.
- Do not assume every dirty file belongs to Sol or current Social work.
- Create or reuse an isolated worktree for every implementation lane.
- Compare branch content before deleting any local worktree.

### Branch ownership

| Lane          | Owns                                                                                                                     | Do not overlap                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| PR #724       | committed skill packs and design-skill catalogue                                                                         | application code                   |
| PR #725       | product review documentation                                                                                             | implementation fixes               |
| PR #726       | v1 security, identity, price truth, Today and install hardening                                                          | Social Night Loop and skill packs  |
| Social branch | Social policy, identity seam, posts, interactions, `/social`, future composer, crews, Night Stories, Social release gate | PR #726 release files until rebase |

PR #726 and Social both touch identity and profile ownership. Merge and verify #726 first. Rebase Social after that merge. Preserve PR #726 security semantics while resolving Social ownership calls. Run full profile, Clerk, RLS, Social, migration, and deletion tests after resolution.

## Fable pickup order

1. Record current `origin/main` SHA and deployed Vercel SHA in a new execution ledger.
2. Captain applies and verifies migration `0070` using PR #726 handoff.
3. Mark PR #726 ready, merge with required checks green, wait for Production Ready, then smoke phone and desktop.
4. Review and merge PR #725 as documentation. Use it as a finding source, but strike items already closed by PR #726.
5. Review PR #724 separately. It has no application dependency.
6. Let active Sol/Codex Task 6 finish or stop at a clean documented checkpoint. Do not take its files while it is active.
7. Rebase Social branch onto post-#726 `main`, resolve ownership conflicts, and rerun full verification before any push.
8. Push Social to a named branch and open one reviewable PR only after branch state is stable. Do not merge partial migration/runtime pairs.
9. Captain applies Social migrations in order with their runtime code. Keep beta off.
10. Assign moderation primary and backup before any invite-beta enablement.

## Recommended next feature lanes for Fable

These lanes avoid active Social Tasks 6 through 9. Plan them after PR #726 merge unless noted.

### Lane A: truthful visual regression gate

Goal: make screenshot checks prove the primary experience is ready, not only that fallback chrome rendered.

Scope:

- align isolated build and Playwright dist directories in the advertised screenshot command
- replace fixed sleeps with loaded-map and loaded-plan signals
- preserve honest error and keyless states
- require 320px, 390px, 430px, and desktop proof for core routes

Why next: current review found the visual gate could pass on `Rounding up the pubs` while Map never became ready.

### Lane B: accessibility foundation for existing non-Social surfaces

Goal: remove repeated navigation and focus traps before adding more product surface.

Scope:

- shared skip link
- correct modal and focus behaviour for half and peek sheets
- persona picker keyboard semantics and focus return
- Map List focus restoration
- assistive loading status for existing non-Social profile and map surfaces

Keep this lane outside `/social` until the Social branch lands.

### Lane C: post-release Venue decision clarity on phone

Goal: make practical information usable at 400px without changing map density or price authority.

Scope after PR #726 Production smoke:

- remeasure every Venue sheet tab, including Last train, at 400px
- change overflow only if PR #726 proof does not hold in Production
- raise provenance and date captions only where rendered text remains too small
- keep community, sourced, historical, and national price lanes visually distinct
- prove no fixed navigation covers actions or trust text

Start only after PR #726 lands because it already changes price truth and Venue reachability. This lane closes measured residual gaps. It does not rebuild that work.

### Lane D: purposeful desktop Today and Tonight

Goal: use desktop canvas as deliberately as Map and Plan.

Scope:

- give Today and Tonight a route-owned two-column or contextual composition
- keep one shared global navigation system
- retain existing weather, price, get-home, and crawl logic
- remove duplicate metadata branding while touching route metadata

Do not redesign Map, Plan, or Social in this lane.

### Lane E: price-free city and Venue-menu proof

Goal: prove a Venue can receive current category prices even when its baseline Pint Price is absent.

Scope:

- add one non-London fixture
- prove overlay lookup and Venue-menu rendering
- preserve community corroboration and freshness policy
- do not launch Manchester until London trust metrics are stable

### Lane F: operate the trust loop

Goal: use shipped refresh infrastructure and produce current reviewed data.

Scope:

- run scheduler dry mode from a stable checkout
- inspect semantic data diff
- review first generated refresh PR
- publish artifact age and row-age distribution
- inspect existing consent-gated Venue, plan, save, arrival, and completion funnel without changing Social analytics code

Do not rebuild scheduler code. Keep analytics work read-only until Social Task 9 clears shared event files. Do not mix Social beta analytics into this lane because Social Task 9 owns that release gate.

## Work Fable must defer

Active Social ownership:

- composer and media
- tag and likeness consent
- Crew Pages and crawl membership
- Social safe-home handoff
- Night Story publication and imports
- Social export and erasure
- Social beta analytics and release gate

Owner or Captain gate:

- production migrations
- moderation duty assignment
- age-assurance provider activation
- event-provider credentials
- native store enrolment
- payments and membership
- city expansion

Also defer protected Social push until identity-bound subscription work exists.

## Evidence index

Use these sources instead of reconstructing today from commit subjects:

- PR #724: committed skill-pack refresh and machine-local skill notes
- PR #725 and branch `codex/full-review-20260805`: `docs/FABLE_FULL_PRODUCT_REVIEW_2026-08-05.md`
- PR #726 and branch `codex/v1-release-20260805`: `docs/V1_RELEASE_HANDOFF_2026-08-05.md`
- Local Social branch: `docs/superpowers/plans/2026-08-05-verified-social-night-loop.md`
- Local Social branch: `docs/social/SOCIAL_BETA_CONTRACT.md`
- Local Social branch: `docs/social/SOCIAL_THREAT_MODEL.md`
- Local Social branch: `.superpowers/sdd/2026-08-05-verified-social-night-loop/`
- GitHub issue hierarchy: #728 through #736

`FABLE_HANDOFF.md` and older PRDs remain useful history, but their live authority claims predate this 5 August snapshot. Refresh their status before using any unfinished list.

## Definition of a safe next plan

Fable's next plan is safe only when it:

- starts from current `origin/main` and records deployed SHA separately
- excludes active Social files and PR #726 files until their ownership clears
- names one owner per file boundary
- states migration and owner gates before implementation
- includes end-to-end browser proof for user-facing changes
- preserves PUBMAXX vocabulary and `docs/VOICE.md`
- does not claim merged, deployed, or verified without named evidence
