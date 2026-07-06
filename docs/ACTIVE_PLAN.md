# Active plan

The current Opus execution plan is **`docs/PRD_OPUS_NEXT_IMPROVEMENTS_2026_07_06.md`**. The broader review/background plan remains **`cc_plan2.md`** at the repo root, updated as **PUBMAXXING Stickiness, Durability, And Map Expansion PRD v3** after the 2026-07-06 Opus review. The earlier framing remains in **`cc_plan.md`** and **`docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md`** as background only. Older PRDs under `docs/` carry a **Superseded** banner where their work has landed.

## What's built (demo-safe, production-shaped)

- **Brand**: public surfaces say **PUBMAXXING**; tagline *"Every pint has a story."*
- **InstaPint**: camera-first Pint Drop composer — "Your pint" (rear camera) + "You at the bar" cheeky selfie (front camera); Instagram-style photo cards. Photos are **real** (Supabase Storage).
- **`/feed`**: image-first social feed of Pint Drops with pub-native reactions (Cheers / Bargain / Chaos / Proper / Legendary) and filters (Tonight / Friends / Near Me / Cheap Legends / Crawls / Golden Days).
- **`/u/[handle]`**: public profile (handle-based, demo identity) with photo grid + saved-pub lists.
- **`/discover`**: cheap-pint leaderboard + editorial lanes (Golden Days / Coding Pint / Then vs Now / Tonight).
- **`/crawls`**: shareable Crawl Story recap + share card.
- **Mobile**: app-wide bottom tab bar (Map / Feed / Log / Crawls / Profile), ≤640px only.
- **Durable social objects**: `/crawls/[slug]`, `/p/[id]`, comments, durable reaction/follow/profile store seams, saved-pub store/API, and share bar are now implemented.
- **Map-first redesign**: full-bleed MapLibre map, price clusters, POI layer, favorite-pint selector, saved-only filter, and compact venue card are implemented.
- **Discovery**: Then vs Now cards plus `/borough` and `/borough/[slug]` pages are implemented.
- **Auth scaffold**: Google sign-in code exists but still needs provider configuration and ownership enforcement before public launch.

## Demo vs durable

Photos persist via Storage today. The social stores now have durable Supabase-backed paths plus demo/memory fallbacks, but durability still depends on the migrations below being applied in the target Supabase project. Real ownership enforcement is still the next auth epic: Google sign-in exists, but profile edits and handle actions are not yet gated by `auth.uid()`.

## Current next package

Use `docs/PRD_OPUS_NEXT_IMPROVEMENTS_2026_07_06.md` for the next implementation package. Highest-priority items:

1. Fix build-mode map pin taps so inspect does not mutate the crawl.
2. Clean mobile map chrome: hide/condense top nav when bottom tabs show, and move venue detail into a real bottom sheet.
3. Fix duplicate borough metadata titles.
4. Add Live Story Map overlays: Story, Tonight, Friends, Pint, and Progress modes.
5. Connect landmarks to nearby heritage pubs and grounded Landlord prompts.
6. Add route quality cards with honest distance/time/price/story stats.
7. Add the TfL-backed Last Pint transport layer: nearest stations, live arrivals, line status, destination privacy, and leave-by countdown.
8. Upgrade profile editing from handle-trust to authenticated ownership after Supabase Auth provider config is confirmed.

## ✅ Migrations applied — durable social persistence is LIVE

Both migrations are applied to the production Supabase project (`iankajxliutqogqkmvdg`), verified via the Supabase MCP (all 11 tables present, RLS on, security advisors clean):

1. `supabase/migrations/0005_pint_drop_vibe_tags.sql` — the `vibe_tags` column. ✅ applied
2. `supabase/migrations/0006_social_layer.sql` — profiles, follows, saved_pubs, reactions, comments, actor-scoped reports, crawl_stories, crawl_story_stops. ✅ applied

So reactions, follows, comments, saved pubs, and durable crawl stories persist to Supabase in production (no longer demo-only). The remaining gap is real **auth ownership** — actions are keyed by a self-asserted handle until Supabase Auth (`auth.uid()` → `profiles.user_id`) gates them.

## Demo checklist (one-minute flow)

Landing → Map (plan a crawl) → **Save as Crawl Story** → `/crawls` recap → **Log a Pint Drop** with a photo + selfie → `/feed` (it appears, react to it) → `/u/[handle]` profile → `/discover` leaderboard. On mobile, the bottom tab bar drives the whole loop.
