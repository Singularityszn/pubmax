# App routes, pages and the request edge

Rules whose subject is a route, a page, a document or the request edge: `app/`, `proxy.ts` and `next.config.mjs`.

Repo-wide laws and the index of every other area file are in the root [AGENTS.md](../AGENTS.md).

Long-form incident history, measured proof and review finding IDs live under [`docs/rules/`](../docs/rules/). Each line below names one invariant and links to its full rule. Write or change a rule in its detail file, and keep its title line here in step.

## Auth and account routes

Full rules: [`docs/rules/app-auth-and-account-routes.md`](../docs/rules/app-auth-and-account-routes.md).

- [A moderator door refuses the DOCUMENT, and /login names nobody until the session answers.](../docs/rules/app-auth-and-account-routes.md#a-moderator-door-refuses-the-document-and-login-names-nobody-until-the-session-a)
- [Dedicated `/login` (alias `/signin`) owns the email-link flow as a first-class page.](../docs/rules/app-auth-and-account-routes.md#dedicated-login-alias-signin-owns-the-email-link-flow-as-a-first-class-page)
- [A password is CREATED behind a session and only ever SPENT without one.](../docs/rules/app-auth-and-account-routes.md#a-password-is-created-behind-a-session-and-only-ever-spent-without-one)
- [AN ACCOUNT LEAVES IN TWO PHASES: THE STORAGE API OWNS THE BYTES, THE TRIGGER OWNS THE ROWS.](../docs/rules/app-auth-and-account-routes.md#an-account-leaves-in-two-phases-the-storage-api-owns-the-bytes-the-trigger-owns-)
- [A PRIVATE NIGHT CAN BE TAKEN BACK, AND ONLY ITS OWNER TAKES IT.](../docs/rules/app-auth-and-account-routes.md#a-private-night-can-be-taken-back-and-only-its-owner-takes-it)

## Landing, city and listing pages

Full rules: [`docs/rules/app-landing-city-and-listing-pages.md`](../docs/rules/app-landing-city-and-listing-pages.md).

- [A governed price landing is a crawler's page, and `/area/{slug}` is HELD.](../docs/rules/app-landing-city-and-listing-pages.md#a-governed-price-landing-is-a-crawler-s-page-and-area-slug-is-held)
- [The root landing keeps pub evidence grounded.](../docs/rules/app-landing-city-and-listing-pages.md#the-root-landing-lands-on-the-answer-and-the-first-tap-is-a-receipt)
- [A city is CHOSEN once, and the surfaces that read it follow.](../docs/rules/app-landing-city-and-listing-pages.md#a-city-is-chosen-once-and-the-surfaces-that-read-it-follow)
- [THE ANSWER COMES FIRST, AND WHAT ACTS ON IT COMES AFTER IT.](../docs/rules/app-landing-city-and-listing-pages.md#the-answer-comes-first-and-what-acts-on-it-comes-after-it)
- [The homepage share card IS the invite preview, so it may hold no figure of its own.](../docs/rules/app-landing-city-and-listing-pages.md#the-homepage-share-card-is-the-invite-preview-so-it-may-hold-no-figure-of-its-ow)
- [The privacy notice is part of the data path, not marketing copy.](../docs/rules/app-landing-city-and-listing-pages.md#the-privacy-notice-is-part-of-the-data-path-not-marketing-copy)
- [THE TWO DOCUMENTS A READER MEETS ON THEIR WORST VISIT ARE GOVERNED TOO.](../docs/rules/app-landing-city-and-listing-pages.md#the-two-documents-a-reader-meets-on-their-worst-visit-are-governed-too)

## API contract and rate limits

Full rules: [`docs/rules/app-api-contract-and-rate-limits.md`](../docs/rules/app-api-contract-and-rate-limits.md).

- [The daily price cap has TWO enforcers, and it is a ROUTE's rule rather than the table's.](../docs/rules/app-api-contract-and-rate-limits.md#the-daily-price-cap-has-two-enforcers-and-it-is-a-route-s-rule-rather-than-the-t)
- [An API error is one envelope, and every mutating route is rate limited.](../docs/rules/app-api-contract-and-rate-limits.md#an-api-error-is-one-envelope-and-every-mutating-route-is-rate-limited)
- [AN UNKNOWN ADDRESS ANSWERS THE ENVELOPE, AND A DELETE STILL ANSWERS AFTER THE ACCOUNT HAS GONE.](../docs/rules/app-api-contract-and-rate-limits.md#an-unknown-address-answers-the-envelope-and-a-delete-still-answers-after-the-acc)
- [THE HEALTH ROUTE ASKS THE DATABASE, AND AN UPTIME MONITOR READS ITS STATUS CODE.](../docs/rules/app-api-contract-and-rate-limits.md#the-health-route-asks-the-database-and-an-uptime-monitor-reads-its-status-code)

## Proxy, CSP, caching and file tracing

Full rules: [`docs/rules/app-proxy-csp-caching-and-file-tracing.md`](../docs/rules/app-proxy-csp-caching-and-file-tracing.md).

- [A file a route opens at runtime is not in the deployed function unless you say so.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#a-file-a-route-opens-at-runtime-is-not-in-the-deployed-function-unless-you-say-s)
- [THE ANSWER IS A PUB PEOPLE ARE TALKING ABOUT, THEN OUR OWN LISTINGS, THEN AN HONEST QUIET NIGHT.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#the-answer-is-a-pub-people-are-talking-about-then-our-own-listings-then-an-hones)
- [A tab you have already opened is not a page you have to fetch again.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#a-tab-you-have-already-opened-is-not-a-page-you-have-to-fetch-again)
- [Exactly five documents are exempt from the nonce, and the list is the fence.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#exactly-five-documents-are-exempt-from-the-nonce-and-the-list-is-the-fence)
- [A STATIC ASSET NEVER RUNS THE PROXY, AND A FAILING PACK IS NOT A FAILING BASEMAP.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#a-static-asset-never-runs-the-proxy-and-a-failing-pack-is-not-a-failing-basemap)
- [The host canonicalisation is for READERS, and `/api` is a caller.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#the-host-canonicalisation-is-for-readers-and-api-is-a-caller)
- [A ROUTE THAT SHIPS A DOCUMENT NOBODY KEEPS, AND THE HEADER THAT SAYS SO.](../docs/rules/app-proxy-csp-caching-and-file-tracing.md#a-route-that-ships-a-document-nobody-keeps-and-the-header-that-says-so)
