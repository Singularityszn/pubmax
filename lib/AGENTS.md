# Policy modules, stores and shared leaves

Modules under `lib/`: the closed vocabularies, the policy leaves and the stores. `lib/harvest/*` follows [scripts/AGENTS.md](../scripts/AGENTS.md), because the harvest commands and the source policy are one rule. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **One owner per rule.** A closed vocabulary lives in one `lib/` module. A policy leaf imports nothing heavy, so a page that needs it does not pull a store behind it.
- **Dual-backend stores share one interface.** Process memory runs keyless. Supabase is the durable backend. Both go through `lib/storeBackend.ts`.
- **Price trust is decided in one place.** `lib/pintTrust.ts`, `lib/priceTier.ts` and `lib/venues.ts` decide price lanes. A retired contributor changes a name, never a price's authority.
- **A bill attachment does not verify a price.** See the [bill check rule](../docs/rules/lib-prices-trust-and-drinks.md#a-bill-earns-receipt-only-when-it-shows-the-price).
- **A referral confers recognition only.** Nothing in the product may branch on it. `lib/referrals.ts` owns the rule, and `__tests__/referralMarkLaw.test.ts` fences it.
- **A flow with three or more states is one machine.** A tagged union and one pure transition in one `lib/` leaf. Effects stay in the hook or the route. See [state machines](../docs/rules/state-machines.md).
- **Push registration is identity-free by design.** `lib/pushTokenStore.ts` stores no account or plan identity.

## Detail

Read a detail file only for the rule you change. Each holds the full rules, pins and history:

- Identity, accounts and sessions: [`docs/rules/lib-identity-accounts-and-sessions.md`](../docs/rules/lib-identity-accounts-and-sessions.md)
- Images, uploads and photo walls: [`docs/rules/lib-images-uploads-and-photo-walls.md`](../docs/rules/lib-images-uploads-and-photo-walls.md)
- Prices, trust and drinks: [`docs/rules/lib-prices-trust-and-drinks.md`](../docs/rules/lib-prices-trust-and-drinks.md)
- Venues, areas, listings and nights: [`docs/rules/lib-venues-areas-listings-and-nights.md`](../docs/rules/lib-venues-areas-listings-and-nights.md)
- Saves, nudges, rounds, reports and Pub Pal: [`docs/rules/lib-saves-nudges-rounds-reports-and-pub-pal.md`](../docs/rules/lib-saves-nudges-rounds-reports-and-pub-pal.md)
- Observability: [`docs/rules/lib-observability.md`](../docs/rules/lib-observability.md). PostHog event names: [`docs/analytics/POSTHOG_EVENT_NAMES.md`](../docs/analytics/POSTHOG_EVENT_NAMES.md). Browser SDK features: [`docs/analytics/POSTHOG_SAMPLING.md`](../docs/analytics/POSTHOG_SAMPLING.md).
- Shared seams (stores, http, freshness, brand): [`docs/rules/lib-shared-seams-stores-http-freshness-brand.md`](../docs/rules/lib-shared-seams-stores-http-freshness-brand.md)
