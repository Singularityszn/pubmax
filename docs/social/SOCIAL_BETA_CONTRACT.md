# Social invite-beta contract

Status: binding release policy for Verified Social Night Loop.

This contract owns policy decisions that cross Social routes and domains. Implementation details belong in their task code and tests. The threat analysis lives in [SOCIAL_THREAT_MODEL.md](./SOCIAL_THREAT_MODEL.md).

## Product boundary

`/social` is the canonical responsive Social shell. `/feed` and `/stories` redirect to `/social`. `/discover` and `/drinks` redirect to `/social?tab=discover`. Redirects preserve no legacy access shortcut.

Social is an invite beta for verified adults. It does not replace the price map, Pint Drops, Visit Reports, Night Memories, venue observations, or existing account ownership. Social posts may refer to those domains, but they do not become ratings and their engagement does not alter venue or price authority.

Feeds are chronological. Paid reach, trends, popularity ranking, and venue ratings are outside the beta.

## Access and identity

One server policy seam decides protected Social access. Every protected API and server-rendered read uses it. Client state may explain an access decision but may not grant access.

The access states are:

| State                       | Reader outcome                                  | Write outcome                                                       |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `preview`                   | Safe metadata preview only                      | Denied                                                              |
| `sign_in_required`          | Safe metadata preview plus sign-in boundary     | Denied                                                              |
| `age_verification_required` | Safe metadata preview plus adult-check boundary | Denied                                                              |
| `verified`                  | Content allowed by per-object visibility        | Allowed by ownership, friendship, moderation, and rate-limit policy |
| `suspended`                 | Safe metadata preview only                      | Denied                                                              |

Full Social content requires both a Clerk product session and verified 18+ state bound to stable product account ownership. A Clerk session is not a legacy Supabase account. Migration requires proof of both sessions, is idempotent, and produces an audit record. A client-supplied handle never proves ownership.

Legacy unverified handles stay frozen. First-touch ownership claims are forbidden. Pseudonyms are allowed. Public profiles, posts, previews, analytics, notifications, and media metadata expose neither date of birth nor an age badge.

Adult verification stores Yoti subject reference, provider, decision, verified-at, expiry, and audit state on the server. Raw identity documents and public age data do not belong in PUBMAXX Social.

External identity or age services failing leaves protected actions closed. Keyless local tests use explicit mocks and never weaken production policy.

## Preview and visibility

Safe preview metadata is the minimum needed to explain that Social exists and why content is unavailable. It may include route-level beta copy and aggregate availability derived by the server. It excludes post text, photos, handles, comments, reactions, hashtags, venue context, crew membership, direct messages, check-ins, safe-home state, verification state, and stable object identifiers that would enable enumeration.

Post visibility is decided on every read path, including feeds, direct links, search, notifications, reposts, quote posts, media delivery, caches, exports, and moderation views.

| Visibility | Who may read full post content                                          | Location rule                                                                                           |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `public`   | Any verified adult who is not suspended or blocked by moderation policy | Public area allowed. Exact venue context withheld unless viewer is a friend authorised for that context |
| `friends`  | Author and mutual friends                                               | Public area and friends-only venue context allowed                                                      |
| `private`  | Author only, plus authorised moderators for a recorded case             | Imported unmatched places and private context stay private                                              |

Friendship means mutual follow state. One-way following does not satisfy a friend gate. Saves are private. Photo tags stay unpublished until the tagged person approves. Removing approval removes the public identity link without rewriting photo provenance.

Reposts, quote posts, notifications, and signed media URLs may never widen source visibility. A visibility reduction takes effect across all derived surfaces. Product copy must not imply that PUBMAX can stop recipients taking screenshots or sharing information outside the service.

## Posts and interactions

Posts are `standard` or `feature_request`. Authors choose `public`, `friends`, or `private` per post and choose a comment policy. Authors may lock comments later. Edits carry an edited marker and immutable audit metadata.

Cheers, comments, saves, reposts, and quote posts use idempotent writes and bounded pagination. Engagement may support the direct interaction, but it never buys reach or creates a popularity feed. Feature requests have staff status and response history without becoming a popularity vote.

OpenAI omni moderation runs after submission. Until an external moderation decision succeeds, publishable content remains held in a queued state. A provider failure must not publish unchecked content. Local tests replace the provider with deterministic outcomes.

## Crew and complete-night safety

Crawl joins, invitations, direct messages, and exact venue sharing are friend-gated. Crew roles never bypass per-post, media, or verification policy.

Crawl chat expires after 30 days. Expiry removes message content and attachments from reader and moderator surfaces, subject only to a narrower legal hold recorded against a specific case. Expired chat does not become an analytics or activity archive.

Safe-home sharing and escalation are explicit, revocable, and consent-based. PUBMAX does not imply that it monitors emergencies or contacts emergency services. Weather and event cards show source and freshness and never appear as posts from AI. AI may assist composition and planning but never appears as a participant, friend, crew member, author, or moderator.

Night Stories remain drafts until every required contributor and photo-tag consent check passes. Imported Google Maps places arrive through explicit export or OAuth consent. Unmatched places stay private until the owner deliberately links or shares them.

## Moderation operations

Social reuses existing moderation queues where their contracts match. Reports queue content for review. A report does not silently delete or hide another person's content. Only an authorised moderator can hide, restore, or resolve it, and every action keeps an audit trail.

Primary and backup moderation ownership is a launch control, not a documentation placeholder:

| Duty              | Named owner | Launch state |
| ----------------- | ----------- | ------------ |
| Primary moderator | Unassigned  | Blocking     |
| Backup moderator  | Unassigned  | Blocking     |

Both people must accept access to the queue, the escalation route, and the duty to resolve reports within 24 hours before any invite-beta flag is enabled. Task 9 records their names and proof of an exercised handover. Until then, every Social invite-beta flag remains off outside deterministic test environments.

P1 risk, credible threats of harm, child-safety concerns, non-consensual intimate media, doxxing, and compromised moderator credentials use an immediate escalation path. The operational runbook must name the path before rollout. Product code must support suspending accounts and holding content without destroying the evidence needed for a specific case.

## Retention, deletion, and export

Retention follows purpose limitation:

- Crawl chat content and attachments expire after 30 days.
- Posts, interactions, crews, media, notifications, and verification references exist only while needed for the feature, moderation, or a recorded legal hold.
- Local drafts stay on the user's device unless the user submits them.
- Unmatched imported places remain private and deletable. They never acquire public status through an import retry or background match.
- Analytics excludes raw viewer coordinates, handles, free text, direct-message content, verification references, and imported-place content.

Task 8 must deliver account export and complete erasure across Social posts, interactions, crews, media, notifications, verification references, imported places, and analytics identifiers. Erasure removes public and friend-visible content immediately, revokes signed media delivery, and schedules durable deletion. Any legally required exception is minimal, case-specific, access-controlled, and excluded from product reads.

Exact deletion windows for live stores, backups, provider records, and moderation holds must be agreed, implemented, and reflected in `/privacy` and `/terms` before beta rollout. This documentation task changes no data practice, so it does not edit those pages.

## Analytics contract

Social funnel events fire only after analytics consent. The shared analytics registry owns a closed event and property allowlist. Unknown properties are dropped before transmission.

Properties are low-cardinality and exclude raw viewer coordinates, precise location, handles, post or message text, hashtags, media contents, imported places, direct identifiers, and companion names. Area-level measurement may be used only where it cannot expose exact venue or movement history. Product metrics never become reach ranking.

Task 9 proves the consent boundary, allowlist, deletion path, and error-rate measurement in browser and route tests before rollout.

## Rollout and beta exit

New Social surfaces use progressive invite-beta flags. Identity, age, visibility, moderation, consent, deletion, and analytics controls are server-enforced and cannot be bypassed by a client flag.

The beta flag stays off until:

- Tasks 2 through 8 and their safety dependencies are complete.
- Moderation primary and backup are named, have working queue access, and have exercised the handover.
- Account export and complete erasure are proven.
- Signed-out preview, unverified adult boundary, verified posting, visibility, moderation, crew join, safe-home, deletion, and mobile layouts pass browser tests.
- Migration forward and rollback proof, accessibility checks, `npm run verify`, and `npm run ci` pass.

Exit beta only after 25 verified adults, 10 completed loops, two stable weeks, report handling within 24 hours, no P1 defects, and Social API error rate below 1%.

If any exit condition regresses, stop expansion. P1 defects, broken visibility, broken age enforcement, unavailable moderation coverage, or failed erasure require disabling protected Social reads and writes until the control is restored. Safe metadata preview may remain only when it does not disclose protected content.
