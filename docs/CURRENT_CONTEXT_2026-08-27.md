# PUBMAXX current context

Snapshot: 27 August 2026, Europe/London.

This document records current operational truth after the 23-27 August merge wave. `CONTEXT.md` remains the domain-language authority. `FableNextSteps.md` remains the detailed product specification. `CodexSolPlan.md` remains a historical handoff and does not prove that unfinished work is complete.

## 1. Source, local, and production truth

| Area | Current state | Decision |
| --- | --- | --- |
| GitHub `main` | Reviewed through #1223 | Only clean release source |
| Production | `dpl_EGv3MXtogGzUbttVDaKATCcH5aLS`, deployed 25 August | Behind current `main` |
| Vercel project | `pubmax69/chengdu` | Deploy only after Captain approval and release gate |
| GitHub Actions | Jobs stop before execution because of account billing | Local verification is required until owner repairs billing |
| Primary local clone | `docs/dag-handoff`, 476 changed or untracked paths, ahead 1 and behind 415 at audit time | Preserve. Do not pull, clean, reset, or deploy from it |
| Clean audit worktree | `codex/review-20260827` from `origin/main` | Review and repair lane |
| Open pull requests | 0 | #1206 and #1211 were superseded and closed |
| Open issues | 15 after closing #1184, #1186, and #1187 with merged evidence | Resolve by release impact |

Production does not contain these merged changes: #1207, #1208, #1209, #1210, #1212, #1213, #1214, #1215, #1216, #1218, #1219, #1220, #1221, #1222, and #1223.

## 2. Product state

### 2.1 Built in source

- London Venue Dataset, MapLibre Map, curated price pins, separate UK Base layer, search, areas, price lenses, venue sheets, and route planning.
- Guest Plan drafting, intent protection, three-to-six-stop Crawl Routes, invites, Open Crew preview and controls, completion seams, and recap statistics.
- Account-bound Pint Drops, Community Prices, moderation, provisional marks, corroboration, and freshness policy.
- Tonight and Out honesty gates, transport context, Pal, profiles, creator-list discovery, Social shells, and consented analytics.
- Mobile first-paint work, signature Map palette, Beermat Drop reveal, lazy Map dependencies, and Pal-to-venue navigation.
- UK OSM harvest machinery and fail-loud Exa handling.

### 2.2 Proven in production

- Home, Map, Plan, Out, Tonight, login, and public profile routes answer.
- Curated London data has about 1,996 venues, 1,042 numeric prices, and 33 boroughs.
- UK Base has 38,215 OSM pubs. These pubs are intentionally separate and unpriced.
- Sample server response times were acceptable: Map about 88 ms, Out about 191 ms, Tonight about 637 ms, Plan about 993 ms, and Social about 1.06 s.
- Social friends launch is off. This is deliberate product gating, not a missing button defect.

### 2.3 Not proven or not complete

- `/api/whats-on` returns zero rows. Tonight cannot supply its main pub-event lane.
- `/api/out` returned 62 London listings, but 61 were not matched to a curated PUBMAXX Venue.
- Production freshness reports `fresh=12`, `untracked=6`, and `unknown=1`. `whats_on` is unknown because migration `0119` is absent.
- No real production evidence yet proves the full create, invite, run, complete, recap, contribute, repeat loop.
- Community-price stock remains thin. A large UK map does not mean verified price, hour, access, or heritage coverage.
- Pal voice remains unavailable. Text chat exists.
- Social provider connection work is preserved on `codex/social-provider-capabilities` at `a97c7b5d5`, but it is based on an older stack and needs a fresh semantic port.

## 3. Review findings

### 3.1 Release blockers

1. Supabase migration `0119` and a successful What's-On refresh are required before Tonight is healthy.
2. Current `main` has not completed a clean production build and browser journey gate for this release.
3. GitHub Actions billing prevents hosted checks from providing evidence.

Resolved in source by #1219: bundled rows retain refresh-owned identity, and pub-only matching excludes non-pub Venue kinds.

### 3.2 Important follow-up defects

- Creator-list discovery now uses one bounded batch read through #1223. The Supabase path resolves claimed profiles once, loads their saves once, and enriches them through one Venue index read.
- #1218 is merged with linked Open Government Licence v3 attribution, 48-hour snapshot freshness, and resilient polling.
- #1211 is closed. Its valid behaviours were ported through #1221 with fresh tests and a full TypeScript check.
- #1206 is closed. Its missing safe fixes were ported through #1220; already-shipped and stale work was not copied.
- `CodexSolPlan.md` says all work is durable while also recording incomplete harvest, editorial, speed, and folding lanes. Treat it as history, not completion proof.

### 3.3 Open issue disposition

| Issues | Disposition |
| --- | --- |
| #1203, #1204, #1205 | Architecture cleanup after current release defects |
| #1185 | Split high-complexity Map owners only with behaviour fences |
| #1183 | Build a consuming moderator surface or delete unused Social moderation backend |
| #1182 | Decide one owner for dormant Social invite beta policy |
| #1181 | Captain repairs GitHub billing |
| #727 | Apply narrow store cleanup only where policy and semantics match |
| #443 | Refresh wrapped-build evidence at final release gate |
| #392 | Soft-launch gate after data and journey proof |
| #437, #390 | Native-store and enrollment milestone after web v0 |
| #287 | Keep other cities as honest previews |
| #282 | Defer voice until text journey and tracing pass |
| #252 | Retain as long-range Local product specification |

Closed with current-main evidence: #1184 by #1198, #1186 by #1199, and #1187 by #1201.

## 4. Data campaign

### 4.1 Current stock

- 38,215 UK OSM pubs are enumerated.
- Earlier Exa pub enrichment produced content for 2,443 pubs, about 6.4 percent.
- Quality sampling found about 27 percent of lore hits referred to a wrong namesake pub.
- Opening-hour coverage from this harvest is zero.
- An earlier bars and website-content pass wrote empty rows after Exa credit refusal. #1215 now makes this fail loudly.

### 4.2 Active work

- Fresh bars enrichment resumed from 500 durable rows after the Mac shutdown.
- Website-content enrichment must run after bars finish. Do not start a duplicate process.
- Fold once after both passes finish and quality sampling passes.

### 4.3 Publication rules

- Venue identity is OSM id, never name alone.
- Heritage needs name and town agreement plus a citation URL.
- An empty harvest row means unknown, not no history.
- Websites and menu links must use HTTPS.
- Lore belongs in lazy venue detail, not pin or slim payloads.
- Do not publish scraped opening hours, prices, access claims, or social handles without direct evidence and policy approval.

## 5. External access and owner actions

Never commit secret values. Required names and decisions are:

| Need | Configuration or action | State |
| --- | --- | --- |
| Durable app data | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, public Supabase keys | Configured in production; apply migration `0119` |
| UK enrichment | `EXA_API_KEY` | Fresh local key exists; credits expire or can exhaust |
| Ticketmaster | `TICKETMASTER_API_KEY` | Connected, but venue matching is weak |
| Skiddle | `SKIDDLE_API_KEY` plus written commercial and logo approval | Captain action |
| Eventbrite | `EVENTBRITE_API_TOKEN` | Provider currently yields no useful stock |
| Pal narration | `OPENROUTER_API_KEY` | Optional; structured fallback must remain honest |
| Product analytics | PostHog public token and project API key | Use existing provider before adding another telemetry stack |
| Auth | Supabase Auth; Clerk needs both Clerk keys if retained | Remove unused Clerk allowlist only after source audit |
| Payments | Stripe keys and product decisions | Held until London v0 journey works |
| Extra place coverage | Google Places key and budget | Captain decision, not a release blocker |
| GitHub CI | Account billing | Captain action |

## 6. Ordered execution plan

### Gate A: data honesty

1. Apply migration `0119` through Captain's database process.
2. Refresh What's-On and prove non-empty, correctly matched pub supply.
3. Add aliases only from verified Venue identity evidence.

### Gate B: close current PR stack

Completed on 27 August:

- #1218 merged as `fa8aa1921`.
- #1219 merged as `84af07523`.
- #1220 merged as `cbd87395d` and superseded #1206.
- #1221 merged as `d1ee7b0b2` and superseded #1211.
- #1222 merged the current-context record.
- #1223 merged creator-list batching and full TypeScript-check repairs.
- Admin enforcement was restored after every merge.

### Gate C: v0 customer journey

1. Signed-out user finds one London Venue with honest price authority.
2. Guest creates and edits a Crawl Route.
3. Account creation claims the Plan without loss.
4. Every share channel creates the same membership.
5. Two browsers complete the Planned Night, recap, and contribution path.
6. Pint Drop produces one durable production row after a signed-in submission.

### Gate D: speed and product quality

1. Keep cold mobile Map pin-ready at or below 4 seconds.
2. Build versioned, bounded repeat-visit caching only after measuring current cache misses.
3. Keep the #1223 creator-list batch contract green and measure its production latency after release.
4. Complete mobile and desktop click, keyboard, screen-reader, light, dark, and consent-state passes.
5. Fix zero-console-error, layout, and copy defects before release.

### Gate E: UK enrichment and growth

1. Finish bars and website-content harvests.
2. Sample wrong-pub rate by source and town before folding.
3. Publish only evidence that passes identity and citation gates.
4. Seed useful creator lists and certified London editorial picks.
5. Measure Plan creation, invite acceptance, second participant, completion, contribution, recap share, and repeat Plan in PostHog.

### Gate F: release

1. Clean `origin/main` worktree only.
2. Migration ledger matches source.
3. Focused and full local gates pass within 8 GB Mac limits.
4. Production build passes with no schema or dynamic-file tracing defect.
5. Capture 390x844 and 1440x900 screenshots before deployment.
6. Captain gives explicit Vercel deployment authority.
7. Deploy `main` once to `chengdu`, smoke critical journeys, and record deployment id and commit SHA.

## 7. Immediate work in progress

- Fresh UK bars enrichment, followed by website-content enrichment.
- Creator-list batching is merged. Full TypeScript check and 37 focused tests passed locally.
- Migration `0119` and What's-On refresh remain Captain database operations.
- Clean production build, browser journeys, and release screenshots remain before deployment.

Do not deploy while any Gate A blocker remains.
