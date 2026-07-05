# Active plan

The current forward plan is **`cc_plan.md`** (PUBMAXXING Social Memory Layer) at the repo root, with the earlier framing in **`docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md`**. Older PRDs under `docs/` carry a **Superseded** banner where their work has landed.

## What's built (demo-safe, production-shaped)

- **Brand**: public surfaces say **PUBMAXXING**; tagline *"Every pint has a story."*
- **InstaPint**: camera-first Pint Drop composer — "Your pint" (rear camera) + "You at the bar" cheeky selfie (front camera); Instagram-style photo cards. Photos are **real** (Supabase Storage).
- **`/feed`**: image-first social feed of Pint Drops with pub-native reactions (Cheers / Bargain / Chaos / Proper / Legendary) and filters (Tonight / Friends / Near Me / Cheap Legends / Crawls / Golden Days).
- **`/u/[handle]`**: public profile (handle-based, demo identity) with photo grid + saved-pub lists.
- **`/discover`**: cheap-pint leaderboard + editorial lanes (Golden Days / Coding Pint / Then vs Now / Tonight).
- **`/crawls`**: shareable Crawl Story recap + share card.
- **Mobile**: app-wide bottom tab bar (Map / Feed / Log / Crawls / Profile), ≤640px only.

## Demo vs durable

Photos persist via Storage today. **Follows, reactions, comments, and saved pubs run in demo mode** (localStorage / synthesized) and become durable once the Supabase migrations are applied — see below. Real Supabase Auth (profiles bound to `auth.users`, RLS on `auth.uid()`) is the next epic.

## ⚠️ Required for durable social persistence

Apply these in the Supabase SQL editor (project `iankajxliutqogqkmvdg`), in order — DDL can't be run from the app with only the service-role/publishable keys:

1. `supabase/migrations/0005_pint_drop_vibe_tags.sql` — the `vibe_tags` column. (Until applied, the app degrades gracefully: the Pint Drop insert retries without vibe tags rather than failing.)
2. `supabase/migrations/0006_social_layer.sql` — profiles, follows, saved_pubs, reactions, comments, actor-scoped reports, crawl_stories, crawl_story_stops.

## Demo checklist (one-minute flow)

Landing → Map (plan a crawl) → **Save as Crawl Story** → `/crawls` recap → **Log a Pint Drop** with a photo + selfie → `/feed` (it appears, react to it) → `/u/[handle]` profile → `/discover` leaderboard. On mobile, the bottom tab bar drives the whole loop.
