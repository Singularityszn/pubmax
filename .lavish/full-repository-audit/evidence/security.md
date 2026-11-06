# Security and data-boundary audit

Pinned source: `04b73e834`. No application edits. Security-specific playbook read. This is a bounded security review, not certification of every route or deployed database. Proofs execute unchanged source with infrastructure doubles; production was not attacked.

## Confirmed findings

### SEC-01 | P1 | Private cover images remain anonymously retrievable

- **Boundary:** `lib/profileVisibility.ts:76` lists `coverUrl` and `coverUrls` among fields withheld from strangers. Avatar is intentionally public and is not this finding.
- **Cause:** `app/api/cover/[profileId]/[generation]/route.ts:8` delegates to `handleProfileImageServe`. `lib/profileImageServe.server.ts:156` reads the profile, checks claim/moderation/generation/object key, but never checks `profile.visibility` or viewer relation. It downloads at line 185 and returns bytes at line 190 with public caching at line 194.
- **Trigger:** A reader retains a valid cover URL from when the account was public or they were a mate. The owner sets private or ends the mutual follow. The reader requests that same URL without authentication. Generation need not change, and the route still serves it.
- **Evidence:** `security-repro.cjs` loads the real serving module. A private claimed profile with an approved cover returns **200**, the private cover body, and `public, max-age=300, s-maxage=3600` to an anonymous Request. No bearer/relationship dependency is invoked. Proof does not substitute the authorization decision, only storage/rate-limit/image-state infrastructure.
- **Impact:** Withholding the URL in profile JSON does not withdraw access to image bytes. Public shared caching can bypass a newly added origin check until old cached responses expire.
- **Confidence:** High, source-executed. No actual user's photo fetched.
- **Remedy:** Gate covers using the same owner/mate decision as profile projection; preserve intentionally public avatars. Serve privacy-dependent covers without shared caching and provide authenticated image loading. Handle previously public cached generations during the rollout.
- **Required acceptance:** stranger/anonymous denied; owner/mate allowed; private/public switch and unmate invalidate access; all rotation slots obey same decision; held old URL and cached response behavior tested. Previously downloaded copies cannot be recalled.

### SEC-02 | P2 | Moderator session has no server-enforced expiry

- **Cause:** `lib/adminAuth.ts:19` declares a 24-hour session, but `hashAdminSession` at line 30 hashes only the permanent admin token. The verifier at line 90 accepts that stable digest without issuance or expiry data. `app/api/admin/session/route.ts:35` puts the deadline only in browser cookie Max-Age.
- **Trigger:** Copy a valid moderator cookie and replay it after 24 hours using an explicit Cookie header. Browser eviction cannot constrain that replay.
- **Evidence:** Unchanged `adminAuth.ts` accepts the same synthetic cookie at creation and with clock advanced 31 days in `security-repro.json`.
- **Impact:** A stolen moderator session remains usable until global ADMIN_TOKEN rotation, contradicting the stated 24-hour exposure bound. This is not anonymous credential forgery; possession of a valid cookie is required.
- **Confidence:** High, source-executed.
- **Remedy:** Signed, versioned session carrying issuance/expiry enforced server-side, or an opaque server-side session with expiry. Invalidate timeless legacy cookies when migrating. Logout revocation is an additional product decision, not needed to establish this expiry defect.
- **Required acceptance:** just-before/at/after expiry; altered timestamp/signature; legacy cookie refused; rotated key refused; malformed cookie refused.

### SEC-03 | P2 | Client can release voice quota without recording actual usage

- **Cause:** `app/api/pub-pal/voice-token/route.ts:139` trusts caller-provided duration, defaulting omitted/invalid values to zero. Release at line 77 clears the reservation; billing runs only when this caller-derived duration is positive at line 96. No issued conversation id binds the release to provider-confirmed completion.
- **Trigger:** An authenticated account with an enabled Pub Pal obtains a voice grant, uses it, then posts `{ "action": "release", "durationSeconds": 0 }`. It can request another grant without consuming its monthly minutes. Releasing before provider completion also reopens the reservation while the prior provider grant remains independent.
- **Evidence:** Source proof returns 200 and calls `release_pub_pal_voice_trial` only, never `record_pub_pal_voice_minutes`. Migration `20260806035204_0070_v1_release_security.sql:199` decrements reservations. `20260808160000_0088_pub_pal_voice_minute_metering.sql:11` admits another when `used_minutes < p_limit` and `session_count < 1`.
- **Impact:** The application monthly spend control is bypassable by a signed-in client. Per-IP rate limits slow calls but do not impose a monthly bound. Provider single-session cap is present: `scripts/pubpal/create-elevenlabs-agent.mjs:106` uses the shared 180-second cap, so this does not claim an unlimited single call. Deployment/provider-wide billing limits were not inspected.
- **Confidence:** High for application accounting bypass; actual bill amount/configuration unverified. No provider calls made.
- **Remedy:** Reserve a bounded allowance before issuing a grant, bind it to a unique provider conversation, and reconcile idempotently from trusted provider completion/duration. Client cancellation can request reconciliation but cannot decide its own billable use. Maintain a deployment-wide voice spend ceiling.
- **Required acceptance:** falsified zero duration, repeated release, release-before-connect, release while live, duplicate provider callback, month rollover, missing callback, and concurrent grant requests.

## Structural concern, not confirmed production exploit

**SEC-H1: Heritage grounding checks citation indices, not factual support.** `lib/heritage.ts:256` accepts any nonempty model text with no `[F#]` markers, and text with valid markers even when its statements are unrelated. System prompt requests factual grounding, but this validator alone does not enforce it. Preserve as an evaluation gap, not a claim that the deployed model has fabricated. Add adversarial provider-output fixtures and prompt-injection evaluations before calling narration fail-closed to facts. Structured fallback is already available.

## Controls observed

- `authServer.ts` defaults to live Supabase `getUser`, rejects invalid/unavailable identity, and documents local-claims exception for repeated own-account deletion.
- Claimed handles require matching verified ownership; existing unclaimed legacy handles intentionally retain demo edits. That legacy policy deserves a product decision but is not labelled an accidental bypass here.
- Private profile JSON derives viewer identity from bearer, not `?viewer`, and uses an allowlist projection with fail-closed relationship resolution.
- DM attachment route gates linked actor and handle ownership before conversation-scoped object lookup; responses use private/no-store.
- Upload preparation restricts MIME/magic bytes, strips metadata, checks dimensions/pixel count, and re-encodes JPEG. Advisory moderation deliberately allows scanner outages; that policy is explicit, not misreported as fail-closed malware scanning.
- Image proxy admits committed dataset hosts, revalidates redirects, refuses SVG, caps bytes while streaming, and uses a fetch timeout. DNS resolution for an already allowlisted compromised hostname was not penetration-tested.
- OAuth state uses server-side state and PKCE for supported providers; stored credentials use AES-GCM. This was a selected-section read, not complete OAuth certification.
- Plan grounding signatures bind venue sets, operations, and deadlines. Only V1 section was read fully; V2 remains partial.
- Cron gate refuses missing production credentials. Latest group-message RLS helper uses live membership and owner checks; effective full migration testing belongs to parent lane.
- Android manifest disables app backup. Native runtime, device storage, OS permission, App Link verification remain untested here.
- Inspected CI jobs restrict credentials on ordinary PR checkout; write-capable event refresh is schedule/manual, not pull_request_target. Full workflow-to-script privilege tracing remains outstanding.

## Dependency and secret screening

`npm audit --json` completed with exit 1: **3 moderate dependency-chain entries, zero high/critical**, all one upstream advisory through `@capacitor/cli -> xcode -> uuid`. This is not three independent exploits. Maintainer advisory: [uuid buffer bounds](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). Affected APIs are v3/v5/v6 with caller-supplied buffers; inspected xcode path calls v4 at `node_modules/xcode/lib/pbxProject.js:90`. No reachable app exploit demonstrated. Do not apply npm's suggested Capacitor downgrade without compatibility review.

Current-file credential-prefix scan covered 1,654 security-surface paths. One match in `lib/nationalPintBenchmarks.ts:165` is the word fragment `cask-` inside a source article slug, not a credential. No confirmed token leak from this limited scan. Git history, entropy detection, private deployment configuration, and log archives were not scanned. Results contain paths/counts only, no credential values.

[OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) supports enforcing timeout server-side rather than relying on browser expiry. Sources fetched during audit.

## Coverage and remaining work

`security-coverage.json` assigns exact paths and methods: 29 end-to-end static reads, 21 selected-section reads at initial write, remaining paths pattern-only or inventory-only. Counts may increase with appended review. These categories must not be collapsed into “reviewed.” `security-repro.json` records isolated executable observations. Parent owns runtime regression/DB/browser evidence.

Still needed for exhaustive review: every remaining route-to-store ownership chain; complete effective migration/rollback catalog; all storage grant/policy combinations; provider configuration and webhook validation; native runtime permission/storage behavior; full AI tool/prompt/data lineage; production Sentry/observability analysis; full secret history; deployment IAM; penetration tests of deployed rate limits/cache boundaries. No live production writes, migrations, deployments, or application fixes performed.

## Follow-up breadth review

### API ownership discovery

`security-api-patterns.json` inventories all 207 route modules by exported HTTP methods and recognizable gate tokens. This is discovery, not proof of authorization. Selected apparent exceptions were traced:

| Surface | Actual boundary | Review limit |
| --- | --- | --- |
| `/api/plans/[id]/constraints` | capability passed to collaboration store; `member()` requires host or collaboration-authorized identity | route + selected memory/Supabase store methods |
| `/api/plans/[id]/invite-rotate` | member capability must resolve to host | complete route |
| `/api/plans/[id]/actions` | capability passed into store mutation | route read, store mutation not fully traced |
| `/api/invite/[token]/rsvp` | invite token, device identity, per-device/per-invite quotas; guest capability issued | complete route, RSVP store not fully traced |
| `/api/referrals/claim-attribution` | verified caller identity plus signed signup proof | complete route |
| `/api/push-tokens` | intentionally anonymous delivery material; per-IP/global registration quotas | route and store complete |
| `/api/area-demand` | intentionally anonymous area signal; optional email; per-IP/global quotas | complete route, data store not traced |
| `/api/wanted/resolve` | public index search, no pasted URL fetched | complete route/resolver |
| `/api/client-error` | public redacted telemetry; separate limiter | complete route, redactor selected sections |
| `/api/ask` | public bounded search with fail-closed per-IP/global paid limits | complete route/model loop; selected tool handlers |
| `/api/pub-pal/llm` | provider shared secret plus paid budget | complete route/shared-secret gate |
| `/api/price-submit` | contribution identity helper for writes, keyless reads/reports | selected sections only |

### External destinations and AI boundaries

- `webPushSubscription.ts` accepts only HTTPS exact maintained push service hosts and path prefixes, rejects credentials/IP literals/nondefault port, and is re-used when decoding stored subscriptions before send. Anonymous token registration therefore does not directly expose arbitrary URL fetch.
- CityMCP default destination is code-owned; route `id` is passed as tool arguments, not a destination URL. Endpoint override exists in internal options for tests; inspected public place route never forwards request endpoint options. Full 1,900-line client not read end to end.
- Ask model loop allows three rounds and three allowlisted tools per round, bounds query/history text, and produces structured tool outcomes. `runAsk` composes answer from outcomes, not model freeform final text. The model can steer tool selection, but inspected map/plan/occupancy handlers return proposals without executing mutations. This stronger boundary must not be conflated with the weaker Heritage narrator validation in SEC-H1.
- TypeSafe destination override is operator environment, not request input. Shared wrapper disables SDK retries and applies timeout plus a global paid budget.
- Arize masks emails and @handles only. Privacy page explicitly states other typed text is transmitted, so phone/address survival is not reported as an undisclosed-processing bug. Provider retention and deployment settings still unverified.
- `dangerouslySetInnerHTML` discovery found three emitter sites: JSON-LD serialization, fixed copy-link script, and speculation JSON. Inspected paths use shared inline JSON escaping or fixed code rather than arbitrary user HTML. This is selected sink review, not full XSS certification.

### Harness and CI boundaries

- Trusted signing refuses ephemeral keys in production/durable modes. Production Supabase/server-env guards check Vercel production before test/build escapes.
- E2E login helper rejects production activation; no route imports it in inspected tree. Test dependency setters exist as module exports, not HTTP setters. No request-controlled debug bypass found in pattern scan.
- **SEC-H2, configuration hardening concern:** `lib/e2eRateLimitAllowance.ts:8` accepts `PUBMAX_E2E_RATE_LIMIT_MAX` without checking deployment mode. `lib/pintDrops.ts:282` applies it before both durable/local checks, so an accidentally deployed test value also widens global paid budgets. No evidence that production sets it. Recommended deny/ignore in deployed production and a startup fence; do not present as a current exploit.
- CI workflow event/permissions scan found no `pull_request_target` entrypoint. Ordinary PR jobs use read permissions. Schedule/manual refresh jobs intentionally have repository write permission and run repository scripts. Third-party actions use mutable major tags; this is supply-chain hardening opportunity, not evidence of compromise. Deployment IAM, branch protection, settings, and action publisher compromise were not tested.
- `security-sql-patterns.json` records forward migration security-definer/search-path occurrence counts. Counts include comments and are deliberately not vulnerability verdicts. Inspected count mismatches in 0047/0048 were comments mentioning functions that do not exist. Effective grants and policies must be read from a fully applied catalog, not inferred by grep.

## Data pipeline follow-up

### SEC-04 | P2 | UK price crawl checks robots for homepage, then reads denied menu paths

- **Cause:** `scripts/harvest/uk-prices/run.mjs:326` calls `robots(entry.origin)` once. Discovered/seeded menus are fetched at line 392 without checking their individual paths. `lib/harvest/robots.ts:429` correctly evaluates the supplied URL path, so this is a caller bypass, not a robots parser defect. Sitemap fetches at line 311 also skip a path-specific decision.
- **Trigger:** A permitted pub homepage links a drinks menu under `/menus`, while its robots file declares `Disallow: /menus`. The homepage passes and the crawler reads the menu anyway.
- **Evidence:** `security-harvest-repro.cjs` executes unchanged `crawlHost` and the real robots checker, with transport/discovery infrastructure doubled. `security-harvest-repro.json` shows homepage allowed, menu denied, only homepage checked, both homepage and menu fetched. No network requests made.
- **Impact:** Violates the project's explicit permission-before-fetch boundary and can contaminate published first-party evidence with material the harvest was instructed not to read. This is not a legal conclusion or evidence that a particular live site was fetched improperly.
- **Confidence:** High, source-executed.
- **Remedy:** Apply source policy and cached live robots checker to every requested menu/sitemap URL before transport, and every redirect destination before following. Preserve denied-path outcomes in the ledger. Add a fixture with allowed root and disallowed linked/seeded menu, including same-site subdomains.
- **Adjacent structural concern:** `fetchText` uses automatic redirects at line 187 and calls `harvestRedirectLanding` only at 195, after transport has contacted the destination. Rejection prevents consuming the returned body but cannot prevent an already issued request. Robots-declared Sitemap URLs are fed directly to fetchText at line 311. Private/refused landing checks need to run before following a hop. No private-network request was attempted by this audit; deployment egress/exploitability remains unverified.

### Price integrity and attribution observations

- Shared UK deterministic reader and judgment policy retain literal price candidates and category plausibility bands. The TypeSafe path classifies snippets; it does not invent the numeric price. On provider failure, `ukPriceJudgment.server.ts:134` deliberately falls back to deterministic classification and records the provider failure reason. Calling a keyed run “all model-judged” would overstate that behavior.
- `scripts/build_uk_price_bundle.mjs:238` projects reviewed updates to venue/category/price/provenance and drops `drinkName` and `servingSize`. Bundle row schema has no serving measure or subtype. This limits safe equivalence between a category floor and a pint/product price. Parent reports pending PRs #1754 (subtype bundle), #1755 (labels), #1741 (cheapest relabel); these are pending remediation, not applied at the pinned commit. No duplicate new finding asserted without tracing a distinct painted claim.
- `lib/drinkPriceUpdates.ts:153` identifies rows by venue/name/category, excluding optional `servingSize`, including menu update application. Two same-named drinks at different serving sizes can collide. Actual published collision or user-facing wrong price has not been demonstrated; retain as schema/data-contract question, not confirmed regression.
- `lib/ukPriceBundle.ts:225` selects freshest observation first, then cheapest within equal observation strings. Loader memoizes successful reads and retries unavailable reads. `authoritativeBundleRows` filters stored standing only; consumers needing current authority must use time-aware standing resolution. All consumers were not traced.
- `lib/drinkSubtypeObservedPrice.ts` sorts eligible subtype observations by cheapest then newest and uses dataset collection day for base rows. This represents cheapest observed, not necessarily a current menu quote. Parent reports pending relabel/subtype changes; acceptance should explicitly distinguish observation, serving measure, and current availability.
- Community corroboration uses distinct actor buckets and collapses unattributed rows into one voice. `pintTrustFor` resolves confirmation/corroboration before split/provisional/aged states. Selected core policy paths reviewed; durable ingestion and every projection were not revalidated in this follow-up.
- `lib/contextDev.ts:394` gates operator URLs and recorded permission; `hasRecordedHarvestPermission` uses host membership. A recorded permission for a page is therefore a broad host permission unless a live robots callback is supplied. Actual caller input into disallowed paths was not demonstrated. Audit caller composition before treating this as complete path authorization.
- PDF parsing disables eval, caps parsed pages and rejects oversized byte buffers. Crawler calls `arrayBuffer()` before PDF size rejection and `text()` before truncation, so size constants do not bound transport allocations. This is a resource-hardening concern for operator CLI runs, not a demonstrated public application DoS.

Pending-work context supplied by parent: #1756 Reddit, #1755 labels, #1754 subtype bundle, #1750 Tavily, #1748 London, #1747 enrichment, #1741 cheapest relabel. This lane did not independently inspect those PR diffs. Their existence neither closes pinned-source findings nor makes their intended fixes regressions.

## Independent challenge of Q-07: accessibility filter bypass

**Conclusion: upheld, high confidence for reachable desktop code behavior.** Independently executed actual `filterVenues` and `filterMapVenues` across 18 cases: step-free, accessible toilet and seated service, each with known true/known false/unknown evidence, each with empty/nonempty price rows. `security-q07-challenge.json` records results. For every empty-price row, map filtering returns the venue even when the selected accessibility facet is explicitly **false**. Ordinary filtering excludes false and unknown; nonempty-price map rows retain that correct behavior. This is stronger than only demonstrating missing evidence.

Source chain independently inspected: `MapToolbar.tsx:413` invokes its planner callback; `PubMap.tsx:6211` supplies `togglePlanning`, which opens planning state at `:2068-2097`. Desktop planner mounts `ControlRail` at `:5157`; its checkbox at `ControlRail.tsx:485` sets `requireStepFree`, with corresponding toilet/seated controls. `filtersForExperienceLens` and `filtersForDrinkPriceLens` preserve accessibility fields. `PubMap.tsx:2814` calls the wrapper that disables all three at `filterMapVenues.ts:24-26` for `prices.length === 0` at `:35`. No callback or state correction rescues that filtering decision. `ControlRail.tsx:476` explicitly promises only publicly confirmed access and hidden unknowns, so this is a contract violation rather than an ambiguous preference.

Known-negative data exists in the curated seed: `venueAccessibilitySeeds.ts:78` records Crosse Keys `stepFree:false`. This challenge **does not establish** that this exact live venue currently has zero price rows or is rendered in the production viewport. The causal defect is established with synthetic known-negative rows passed through real production functions. Browser canvas behavior, current production data combinations, and actual user harm were not observed here. Phone planner deliberately does not mount ControlRail; do not describe Q-07 as a phone accessibility-checkbox defect. Existing selected/deep-linked forced-venue behavior is separate and not needed for this proof.

P1 is defensible because a positive access filter promises a physical access requirement and silently admits known-negative rows, potentially preventing a planned visit. This is product access correctness, not an auth exploit. Acceptance should preserve true rows, exclude false/unknown rows regardless of price hydration, and confirm desktop planner result/canvas behavior end to end.

## Final bounded AI and outbound-request challenge

**No additional confirmed injection exploit found in inspected paths.** This conclusion is limited to source paths below and the offline validator proof, not adversarial provider evaluation.

- **Ask tool authority:** `modelLoop.ts` accepts only registered names before dispatch and caps three calls per round/three rounds. Untrusted query/history and JSON tool data can influence subsequent model choices. They do not add tool names, change the fixed OpenRouter URL, or supply arbitrary executable code. JSON tool data is not an instruction-isolation guarantee; capability restrictions are the meaningful boundary here. `runAsk.ts:221` composes final answer from merged tool outcomes rather than freeform model final prose.
- **Writes require user action:** inspected `propose_plan` resolves candidates from the loaded venue set and returns a draft proposal; `propose_map_action` returns map/open proposals; `toolReportOccupancy` resolves a listed venue and returns a proposal without writing. `MapConciergeAsk.tsx:120` applies these only via the button handler at `:272`. Occupancy confirmation then enters its separate authenticated request path. A malicious retrieved instruction could still steer a misleading proposal; no automatic write from tool output was found. Raw finite fly-to coordinates are allowed proposals, so geographical correctness is not guaranteed by the tool name alone.
- **Outbound URL versus argument:** Ask journey strings are passed as JSON arguments to `get_journey`, not concatenated into an HTTP destination. `citymcp/client.ts:25` fixes the endpoint; its override is internal options. The inspected Ask caller passes only fetch implementation, not a model-controlled endpoint. Upstream CityMCP's handling of hostile location strings is outside this repository and was not tested. No provider/network calls were made.
- **Plan generation:** selected source shows request/intake reconciliation, dataset candidate selection, constraint evaluation and signed grounding proofs rather than model-authored arbitrary stop objects. Explicit intake/context can override inferred fields by documented authority. Concierge model intent is clipped and validated against allowed choices; area needs a verbatim user-text match. This is not certification of every optimizer constraint or every DTO/link consumer; large generation/selection modules received selected-section reads only.
- **Heritage grounding remains SEC-H1:** facts and question enter one user prompt; the model has no tools in this narrator path. Offline `security-ai-boundary-proof.json` executes unchanged sanitizer: an unsupported claim with no marker and the same claim with valid `[F1]` survive; `[F999]` is rejected for a one-fact context. This proves limited validation, not that a real model was induced to fabricate or that any deployed answer is false.
- **Rendering:** inspected Ask and Landlord answer fields render as React text children, not HTML/Markdown. Arbitrary HTML accepted by the heritage text sanitizer therefore does not become executable markup in `LandlordPanel.tsx:133`. Citation URLs are a separate trust boundary: `LandlordPanel.tsx:145` assigns stored `c.ref` directly to href; `heritage.ts:113,224` carries database source references through. Model output does not author this citation list. Earliest heritage migration grants public select and no public write policy; current effective grants and every enrichment producer were not re-proven here. Record URL-scheme validation at ingestion/rendering as hardening, **not a confirmed attacker-controlled XSS finding**. React text escaping alone is not evidence that arbitrary destination URLs are safe.

Recommended offline acceptance: reject unknown tool names; preserve call caps on malicious tool replies; ensure proposals do not mutate until confirmed; keep endpoint selection independent of model args; test citation scheme validation separately from text escaping; score unsupported heritage claims and instruction-bearing facts against the actual narration contract. Current proof covers validator behavior only.
