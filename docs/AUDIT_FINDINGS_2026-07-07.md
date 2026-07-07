# Pre-deploy adversarial audit — 2026-07-07 (HEAD e21a318)

Read-only audit of committed code. Fix priority before final Vercel deploy.

## CRITICAL (real user-facing bugs — fix now)
- **C1** last-train drops the real last train 00:00–04:00: `dayTypeForDate` reads the London weekday off `now`, so post-midnight it picks the wrong service day and rejects the still-running previous-day trains. No service-day rollback. `app/api/last-train/route.ts` + `lib/tfl.ts`. Fix: before ~04:00 use the previous service day's schedule.
- **C2** post-midnight minutes math says "safe" after the train left: `route.ts:527` adds +1440 based on the entry's static `pastMidnight` flag, not current time. A 00:30 train at 00:45 reports ~24h left. Base the +1440 on actual now. (Also `live:true` hardcoded at ~540 even for timetable data.)

## HIGH
- **H1** report-hide threshold (2) trippable by one actor: per-actor report budget is 8/60s with no (drop_id, actor_hash) dedup. Cap per-actor report budget at 1, or dedup at the DB. `lib/pintDrops.ts:325`, `app/api/pint-drops/route.ts:222`, `lib/pintDropsStore.ts:474`.
- **H2** crawl edit/delete authorship forgeable (destructive authz bypass): `isAuthor` trusts body.handle, no JWT. `app/api/crawls/[slug]/route.ts:55,90`. TRUE fix needs auth (Google OAuth off) — document + tighten what's possible.
- **H3** reaction toggle non-atomic (SELECT→DELETE/INSERT): concurrent toggles → uncaught 23505 → spurious 503, or lost DELETE → wrong final state. `lib/reactionsStore.ts:79`. Catch 23505 + recompute, or upsert RPC.
- **H4** SW serves price_updates/latest.json cache-first → stale sourced price, no freshness signal. `public/sw.js` + `components/PubMap.tsx:422`. (Mitigated: fresher community drop still wins.)
- **H5** "Live from TfL" label shown for timetable/unavailable data. `components/map/LastTrainCard.tsx:204`. Gate on anyLiveDepartures.

## MEDIUM (mostly known-pre-auth / self-asserted trust)
- legacy ("Family Table") drops render full handle+price+note on the fully-public `/ledger/[venueId]` with no viewer gating — "ledger-only privacy" is not private. `app/ledger/[id]/page.tsx:134`.
- friends drops readable by passing any known-follower `?viewer=` handle.
- comment/reaction GET reads not gated by parent-drop visibility; notifications inbox readable/mutable by handle alone.
- report fallback (pre-0004) lost-update race; profile unlinked-handle land-grab; rounds non-transactional TOCTOU; venue index silent-catch disguises outage as 404.

## LOW
- client relativeTime has no future guard (4 components) → future ts prints "just now".
- rate limiter fails open across serverless instances (documented).
- presenceStore.clean() control-char regex corrupted to `[ -]`.
- OG footer domain typo `pubmaxing.app` → should be `pubmaxxing.com` (`opengraph-image.tsx:312`).

## Verified SOUND (non-findings)
Realtime signal-only contract airtight; image upload (magic-byte + strip + sharp) strong; admin gate constant-time header-only; profile writes JWT-verified; DTO choke point withholds anonymous handles; heritage LLM fallback honest.
