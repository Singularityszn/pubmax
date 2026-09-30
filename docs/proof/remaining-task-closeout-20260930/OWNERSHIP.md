# Current ownership

Snapshot: 30 September 2026. This table was established before any application
edit. No application edits were made by this lane.

| Owner | Reserved work | Checkout and branch | Remaining boundary |
| --- | --- | --- | --- |
| `Refine Pubmaxx v0`, `01a0ebf5-4fbd-7072-8f5e-082204b8184f` | Map loading, Inspector scheduling, public venue cache, UI refinement, A/B measurements and its child lanes | `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx`, `codex/v0-integration` | Final API-first Inspector candidate needs complete measurement and final regression gates. |
| `Review and merge nine PRs`, `01a0f0c9-1ac7-7f10-a46e-43350f0dd8b6` | Nine-PR integration, history/navigation race, parser, drink/price evidence, modal/tabbar fixes, release and deploy | `pubmax-pr-merge-20260930`, `pubmax-pr-repro-20260930` and its no-mistakes worktree | Final candidate verification, merge and release. Port 55351 and its own `.next-prod` are reserved. |
| `Complete PUBMAXX audit, maps and friend…`, `01a0ef53-4a88-7553-bfa0-b9983e2edf0a` | Original friends implementation, migration 0175, public venue MCP, selected historical source preservation and their publication/runtime | `/Users/karanmanoharan/.codex/worktrees/936f/pubmaxx`, `codex/public-venue-mcp-20260929`; original `pubmaxx-friends-20260929`, `codex/friend-location-20260929`; audit `codex/task-github-audit-20260929` | Final friends gates and privacy proof, MCP review decision, audit publication decision. Friends runtime slot 09:20-09:45 UTC uses port 3353. |
| `Complete PUBMAXX audit, maps and friend…`, `01a0f0b6-3caa-75d0-960b-1d2a096732e5` | PostHog public venue/price import configuration | Browser/account work, plus recovery lanes named below | Paused for the human to enter the existing database password and save the prepared host correction. |
| This closeout lane | `docs/proof/remaining-task-closeout-20260930/` only | `/Users/karanmanoharan/.codex/worktrees/d38d/pubmaxx`, `codex/remaining-task-closeout-20260930` | Freeze receipt, verify, publish reviewable PR. |

The two completion chats have the same displayed title. Their IDs and checkout
paths distinguish their ownership. The active coordinator was recovered from
`docs/proof/completion-recovery-20260930/README.md` in the recovery checkout,
then inspected read-only. The originating audit chat confirmed the reservation.

The independent recovery worktrees remain preserved:

- `pubmaxx-maps-completion-20260930`, `codex/maps-completion-20260930`.
- `pubmaxx-deps-completion-20260930`, `codex/deps-completion-20260930`.
- `pubmaxx-friends-completion-20260930`, `codex/friends-completion-20260930`.
- `pubmaxx-chatgpt-completion-20260930`, `codex/chatgpt-map-completion-20260930`.

Their earlier receipts identify duplicate map/dependency inclusion and transfer
of useful friends repairs to the original owner. They are evidence sources,
not abandoned worktrees available for reassignment.

## Scope decisions

Issue [#1843](https://github.com/Singularityszn/pubmax/issues/1843) remains open,
but the release integration already contains `lib/greatCircle.mjs` and typed
adapters in `lib/haversine.ts` and `scripts/lib/geo.mjs`. The release owner
explicitly reserves that work. Its source was checked read-only; no second
implementation or issue closure was attempted.

The original friends specification states one hour of foreground-only sharing,
with three-decimal coordinate reduction and a 120-second stale cutoff. The
originating audit chat confirmed that this was the earlier approved policy.
The later research proposal of two hours and 90 seconds does not replace it.
No sharing-policy change belongs to this evidence task.

All app remainders identified in this pass have existing owners. This lane
therefore completes the unclaimed coverage and evidence receipt instead of
creating duplicate map, friends, MCP or dependency changes.
