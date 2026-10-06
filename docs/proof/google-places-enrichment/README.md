# Google Places venue content

Collected 4 October 2026, after the closure lane released the shared API key. Current monthly Places request usage was read immediately before collection: 15,429. Dry-run projection was 3,053 Details calls at USD20 per thousand, or USD61.06, below the authorised USD85 task cap. All four fields share one Enterprise request; there is no second contact-field charge.

The completed run made 3,053 requests with zero HTTP errors. Monitoring usage afterwards was 18,482, exactly 3,053 above the pre-run count. Listed-rate spend is USD61.06, with no free allowance assumed. This is request-ledger spend, not a billing-invoice reconciliation. Both original daily limits were restored and checked: Search 100, Details 60. See [run-summary.json](run-summary.json).

Copied fields cover 2,935 regular schedules, 3,053 addresses, 2,807 national phone numbers and 2,627 websites. All 676 previously incomparable pubs were requested; 639 produced usable regular hours. All 249 mismatches now have Google regular hours. The other 37 incomparable pubs have no usable schedule in this artifact; missing values remain unknown. Every returned field has its own request timestamp and source. The registry uses the oldest field timestamp. Runtime freshness is checked per field over 30 days.

Before/after API evidence for Admiralty is in [admiralty-detail.json](admiralty-detail.json): the old phone was absent and opening state unknown; the new phone is callable and seven-day hours make opening state available. Google address and website replace the older values. This is local browser/API proof, not deployed production proof.

Browser evidence uses a private server on port 32121 and an isolated Chrome session. Admiralty is a curated detail reached by its canonical id and exact OSM alias. Rockwell is a UK-base sheet reached by its base id and location hint, exercising the existing harvest-overlay request. Each sheet renders Google hours and phone; Rockwell also renders the copied website.

- [Before desktop, 1440×1000](before-admiralty-1440.png)
- [Before narrow window, 500×844](before-admiralty-500.png). Chrome window resize imposed a 500px minimum; this is not a 390px phone capture.
- [After desktop, 1440×1000](after-admiralty-1440.png)
- [After phone, 390×844](after-admiralty-390.png), captured with mobile viewport emulation.
- [UK-base phone, 390×844](after-rockwell-390.png), captured with mobile viewport emulation.

Focused tests cover per-field aging and fallback, safe contacts, unknown/future hours, verified-id-only priority, attempt spend, normal/failure quota restoration, and recovery after all requests complete but restoration was interrupted. The committed-data fence limits copied content to the four authorised fields and checks verified identity, per-field dates and spend arithmetic. Older verification ledgers retain their verdict-only format.

Validation passed with `npm run verify:no-mistakes`, the repository wrapper for full `npm run verify` against committed bundled data. Coverage passed 1,767 suites and 19,269 tests; the separate RLS run passed 48 suites and 465 tests, with its serial harness proof also green. Data validation, database types, TypeScript, ChatGPT map tests, dead-code gate, e2e-skip gate, freshness, install-script allowlist and vulnerability audit passed. Three credential-dependent store feeds remain unmeasured by the advisory freshness check. The new CLI's final focused lint and all three runner tests passed after extracting option parsing; pre-existing complexity warnings remain elsewhere.
