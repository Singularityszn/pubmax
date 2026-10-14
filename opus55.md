# PUBMAXX launch work and Claude handoff

Snapshot: 14 October 2026. Repository: `Singularityszn/pubmax`.

This document records the launch work, its evidence, current tasks, and remaining tasks. It is a dated handoff, not a launch approval.

The launch candidate is still unpublished and under its original pipeline owner. The current product verdict is **no-go**.
The main remaining reproduced defect is a valid budgeted vegan request that returns false "no matches" results.
Real service, account, native, privacy, performance, and release requirements also remain open.

This handoff is a separate documentation change. Its publication does not publish or adopt the launch candidate.

## Product goal and user direction

The user wants a usable London venue app before a proper launch. The work began with desktop search that did not close correctly.
The user asked for computer-use testing, sign-in checks, button checks, smoother navigation, better design, and up to five supporting agents.
The user also requested package and skill updates, continued permitted menu collection, and useful food and drink choices.

The intended journey is finding a recorded option, understanding its value, opening its venue, and making a night to share with friends.
Food and alcohol-free choices must remain useful alongside pints, wine, cocktails, and other drinks.
Fast food and richer food remain valid choices. Nutrition comparisons require recorded publisher facts, not inferred health scores.

The existing product rules constrain subscription work. Revenue starts with venues, not drinkers.
Year in Pints remains free. Referrals confer recognition, not capabilities.
Venue operator and entitlement work remains contract preparation until a separate approved commerce scope exists.
No drinker paywall, Stripe Checkout, or payment implementation was created during this work.

The governing documents are [AGENTS.md](AGENTS.md), [the design system](docs/DESIGN_SYSTEM.md), and [the product voice](docs/VOICE.md).
The existing [PLG strategy](docs/plans/PLG_STRATEGY.md) and venue operator ADRs retain roadmap ownership.

## Current source and ownership

The following identities were checked during this handoff preparation.

| Item | Current recorded state |
| --- | --- |
| Original launch run | `01M4TQ7SJGTFSG7YARX0NT0BGJ` |
| Launch branch | `codex/desktop-search-usability` |
| Original caller checkout | `/Users/karanmanoharan/.codex/worktrees/desktop-search-usability/pubmaxx` |
| Caller head | `be3925ba786ae83d640ec611da0fcafea987f552`, clean, `pipeline_owned` |
| Native pipeline checkout | `/Users/karanmanoharan/.no-mistakes/worktrees/0a94b5a8763e/01M4TQ7SJGTFSG7YARX0NT0BGJ` |
| Preserved pipeline head | `7ffe9efec140bd11d2c14a1769446dba379f2e8f` |
| Actual gate | `Test/fix_review`, no-go, two auto-fix findings |
| Uncommitted pipeline work | One actor-owned line in `e2e/night-mode-chrome.spec.ts` |
| Captured verification plan SHA-256 | `4a67cc51b7fc4882c90ab03b1e3e0773cf9804758f47086ddfb0ce6cf86dd78b` |
| Original supervisor | Writer PID 599 and the existing coordinator routing |
| Last admitted QA family | Decision 199 family, fully released at 12:06:26 UTC |
| Next source instruction | Decision 201, authorised and not yet executed at this snapshot |
| Documentation base | Fresh `origin/main` at `599252af3019f3776b5d78d297fae2d871fbd87f` |

The caller and pipeline heads differ because the pipeline owns unpublished fix commits.
The launch run has not reached Push, PR, or CI. It has no published candidate PR.
The uncommitted Night fixture means the Native tree is not clean.
Its disposition is explicitly retained for the next supported original FIX actor.

Decisions 182, 193, and 199 each authorised one response. Those responses are consumed.
A command observer timeout did not stop their actors and did not establish a pipeline failure.
No response may be repeated merely because the observer expired.

## Completed source work and evidence limits

These changes exist in the preserved launch history. They are not a claim that every feature is released or accepted.

| Area | Work completed in the candidate | Remaining acceptance |
| --- | --- | --- |
| Desktop search | Popup dismissal, close behaviour, search focus return, and retained selected-venue history were repaired and exercised. | Final combined production and native journeys. |
| Toolbar beside a venue | The user approved a separate overlap repair. Navigation remains usable beside the venue drawer. | Final combined layout and interaction proof. |
| Filters at 800px | A reproduced panel reached 849.45px on an 800px viewport. The 641px to 900px anchoring repair passed five development browser cases. | Retain this regression in the final production matrix. |
| Escape and Back | Shared dismissal ownership closes the newest visible account menu or panel. Hidden Ask no longer consumes another panel's dismissal. | Final signed-account and actual native Back proof. |
| Command palette | Pending opening, cancellation, focus isolation, and Escape handoff were repaired. The palette fixture blocks service-worker interception. | Final production, device, and delayed-download cases. |
| Venue tabs | Food drill-in, Back focus, Menu re-entry, and repeated keyboard navigation received source fixes and browser checks. | Preserve all five-tab cases on the final combined source. |
| Food presentation | Food includes eligible pubs and bars. Recorded menus expose prices, dietary facts, publisher calories, and their separate dates. | Budget and calorie conjunctions, exact portions, and broader coverage. |
| Phone food and drink rows | Long attribution no longer squeezes names into narrow columns. Drink attribution has its own phone row. | Final viewports, themes, text sizes, and native rendering. |
| Fonts | Root body and heading stacks preserve generated Next.js fallback families before JavaScript and after hydration. | Final source proof. No CLS or speed improvement was measured. |
| Pub Pal first use | Greeting requires no request. Available voice choices and fallback behaviour are explicit. Saved choices survive phone Back and reload. | Actual personalised service turns and provider audio. |
| Pub Pal recovery | Retrying the exact failed question preserves a newer unsent draft. Duplicate retries are blocked. Sign-in return received controlled browser proof. | Configured service failure and recovery. |
| Pub Pal facts | Original item, category, serving, price, transit, and discovery intent received shared-boundary fixes. Menu facts have source doors and read dates. | Successful combined constraints and correlated provider replay. |
| Failure diagnostics | Typed Pal failures produce closed private code, stage, reason, and duration records. Public responses and deadlines remain unchanged. | Request-specific diagnosis of the actual configured failure. |
| Planning and Night | Transit origins, destination preservation, crawl endings, guest permissions, and feedback received pipeline fixes. | Remaining real service, sharing, and exact-head performance proof. |
| Profile focus | Closing the inline editor restores the Edit profile trigger in mounted checks and controlled browser journeys. | Authorised real-account Save and final integration. |
| Private agent provisioning | A user-approved private Pub Pal agent and restricted credential setup were prepared. A support request was sent. | Live binding, Main privacy, traffic isolation, and provider acceptance. |
| Deletion-only writer | A narrow privacy update path and synthetic transport tests preserve unrelated settings and refuse unsupported projections. | This is source and synthetic proof. No live privacy update is approved or proven. |

The earlier source record contains browser proof for search, source disclosures, drink servings, food layouts, and fonts.
The latest phase re-exercised relevant journeys on `7ffe9efe` with local development fixtures.
Older production builds validate their own heads. They do not validate a later head.

## Recent fix history

| Source | Actual outcome |
| --- | --- |
| `be3925ba7` | Original submitted caller candidate, with UX, menu, package, skill, and font work. |
| `cc41ddd8e` | Pipeline repairs included Ask parsing and canonical venue assertions. The 800px Filters issue remained. |
| `a91f3fd52` | One palette fixture line was committed. The actor declined the private writer repair because its delivered authority and input paths were insufficient. |
| `e4a5872eb` | Filters anchoring and the deletion-only writer were committed. Five development browser cases and 76 focused CLI tests passed after RED reproduction. |
| `e4a5872eb` full gate | Configured verification failed with four TS2532 errors. The new helper also introduced complexity and unused-binding warnings. |
| `e4a5872eb` product phase | A private production build passed. The phase recorded 37 passed and eight untested scenarios with disposable auth and deterministic fixtures. |
| `7ffe9efec` | Four fixture type failures and two new helper warnings were corrected without changing the writer contract. |
| `7ffe9efec` full gate | Configured verification passed. The latest product phase still failed the valid budgeted vegan request. |

Decision 193 resolved input transport for its actual actor, PID 11270.
That actor read and hash-checked the pinned update contract, Main semantics, finding, and instructions.
Transport success for that actor does not prove live provider access or deployment binding.

Decision 199 used its exact execution packet once. Its fix actor was PID 41299.
The durable selection contained `test-1`, `required-configured-verification-failed`, and `test-3`.
Its evidence actor was PID 27087. Both completed before the recorded family release.

## Latest verification

The original configured verifier passed at committed `7ffe9efec140bd11d2c14a1769446dba379f2e8f`.

| Check | Recorded result |
| --- | --- |
| Unit tests | 23,988 passed and one existing skipped case |
| PostgreSQL tests | 554 passed |
| Serial SHM tests | 10 passed |
| Four new TS2532 failures | Corrected |
| Two new privacy helper warnings | Corrected |
| Other lint warnings | 18 remain disclosed |
| Store freshness | Three feeds remain unmeasured |
| Latest product matrix | 26 passed, one failed, nine untested, across 36 scenario records |
| Latest product runtime | Keyless private development server, deterministic map fixtures, and auth or retry boundary doubles |
| Exact-head production build | Unproven at `7ffe9efe` |

The product actor recovered from development server failures by using Turbopack with the same 2GiB Node limit and one Chromium worker.
It did not produce a new exact-head production build.
Decision 199 allocated a serial 8GiB production phase, but the actor reported that allocation unavailable.
The authority-delivery cause remains unestablished. A development pass cannot replace that requirement.

The Night fixture set `pubmax:e2e-defer-shell:v1` to `now` before the seeded journey.
Eight Night cases then passed with unchanged assertions and timeouts.
That one-line fixture remains uncommitted. The earlier full pass does not validate the later dirty tree.

All owned QA services from the decision 199 family were released through their original owner controls.
The recorded actors were absent, port 38197 was closed, and owned checkout, executable, and PostgreSQL process counts were zero.
The parent sent no signals. This receipt does not establish a quiet host or exclusive remote ownership.

## Current tasks

### Budgeted food selection

The current gate contains `published-menu-budget-selection` and `test-2`.
The request "Vegan food under £10 at The New Inn" returns HTTP 200 with no cards.
The same failure occurs through `/api/ask`, `/api/pub-pal/chat`, and rendered chat at 390px and 1440px.
Removing the budget returns accepted vegan items. The shared reader treats budget wording as item-name tokens.

The accepted New Inn Ealing venue is `venue-17qpap6`.
Its recorded menu supports the following vegan items below £10 and 500 publisher item kcal.

| Recorded item | Price | Publisher item kcal |
| --- | --- | --- |
| Mixed Olives | £5.00 | 163 |
| Padron | £5.50 | 104 |
| Hummus | £7.50 | 391 |
| Broccoli, a side | £6.50 | 172 |

The required result preserves every requested predicate, stable identity, source, and independent evidence date.
Missing facts cannot satisfy a calorie or dietary condition. Eligible counts and result caps must remain clear.
Publisher item calories do not establish whole-meal, per-person, allergy-safe, or healthy-choice claims.

Decision 201 authorises one minimal original same-run correction.
Its selection includes the two current findings and the added `required-current-head-production-validation` finding.
It also authorises retaining the existing Night fixture through the original supported actor and executor.
No parent source edit, cleanup workaround, second decision 199 response, or source adoption is authorised.

### Production evidence delivery

Decision 201 carries an explicit current production grant through the existing supported phase evidence transport.
The next original validator must actually read that grant and record the current head, hash, and capacity floors.
An unsupported transport or dirty-tree refusal remains an explicit blocker.
There is no permission to replace the controller, change the captured plan, or substitute development proof.

### Combined food choice and portions

The narrow £10 failure is part of the wider original choice requirement.
Successful conjunctive budget, dietary, and publisher-calorie selection remains required.
Named-venue and supported canonical-area journeys must work without broad false scarcity refusals.
The accepted Ealing facts can support that journey without invented coordinates or complete menu claims.

The Eagle Ice cream item also needs its recorded three-scoop portion restored.
Its stable identities are `venue-1hz0avt` and `food-1j3poi9`.
The publisher records £5.50 and 238 kcal for that item.
Receipt cleanup removed the numeric portion from accepted and runtime representations.
The repair must carry the fact through receipt, data, reader, menu, Pal cards, and replay.
It must not rename the item, change its ID, divide calories by three, or invent one-scoop values.

The original pending findings are `original-scope-recorded-menu-choice` and `published-food-portion-lost`.
They remain required even when the next gate lists only the newer budget and production findings.

## Food, drink, and collection work

The accepted candidate records 2,620 food rows, 89 calorie-bearing rows, 171 explicit dietary rows, and 1,585 drink rows.
Those totals are recorded dataset counts, not live availability or complete restaurant coverage.
The 89 calorie rows do not establish complete-meal coverage.

The original imports added 48 food prices, 47 calorie facts, and 18 explicit dietary rows.
The guarded Eagle drink import added 22 GBP price atoms while preserving 1,563 prior rows and their identities.
Three permitted official PDFs supplied 250 staged drink atoms.
The 228 wine figures with unconfirmed currency remain excluded.
Drink calorie facts remain staged.

Twenty expired August food rows remain excluded.
Fourteen later staged menu rows produced zero imports while St John and New Inn identity questions remained unresolved.
Ealing duplicates and canonical identity need resolution before adoption.
Zero imported rows do not establish that a publisher has no priced menu.

Every collection URL remains subject to `lib/harvest/sourcePolicy.ts`, publisher permissions, robots checks, and provenance.
Existing finite collection batches were spent. Closed collection lanes are not permission for another producer or paid call.
Future collection needs its actual source policy, ownership, credit, and capacity conditions checked.
No guessed currency, coordinates, opening hours, stock, or dietary tag may become an accepted fact.

## Packages and skills

The 13 October package refresh changed fourteen compatible package or override rows.
The exact real SDK test dependency was declared later in the combined candidate.

| Package or override | Candidate version |
| --- | --- |
| `@ai-sdk/otel` | `1.0.138` |
| `ai` | `7.0.138` |
| `@radix-ui/react-slot` | `1.5.0` |
| `@typescript-eslint/parser` | `8.71.2` |
| `vitest` | `5.0.4` |
| `@vitest/browser-playwright` | `5.0.4` |
| `@vitest/coverage-v8` | `5.0.4` |
| `effect` | `4.0.4` |
| `lucide-react` | `1.56.0` |
| `posthog-js` | `1.438.9` |
| `maplibre-gl`, exact pin | `6.14.0` |
| Root PostCSS override | `^8.5.30` |
| ChatGPT map `postcss` | `8.5.30` |
| ChatGPT map `zod` | `4.6.7` |
| Additional test dependency `@elevenlabs/client`, exact pin | `1.27.0` |

The TypeScript 6 bridge remains pinned at `6.0.3`.
The existing native TypeScript CLI alias remains locked at `7.0.2`.
Compiler mode, performance ceilings, install-script allowlists, and audit severity did not change.

The existing development-only braces advisory exception remains narrow and unchanged.
The recorded registry audit found no compatible released patch at that time.
A downgrade to Next 14 was not accepted. The production-only audit remains part of configured verification.
This historical audit is not a fresh claim about today's registry.

Eight skill trees and eleven files were refreshed.

- `brandkit` preserves existing assets and requested dimensions.
- `gpt-taste` and `minimalist-ui` add reduced-motion guidance.
- `redesign-existing-projects` preserves named, operable collapsed navigation.
- `design-taste-frontend` corrects animation and resize guidance.
- `state-machine` and `variant` preserve narrow-screen choices and local Next.js corrections.
- `elevenlabs-agents` corrects draft compilation and procedure validation guidance.

Custom skills, discovery names, frontmatter, and local corrections were preserved.
The discovery scan recorded 88 unique names and no duplicates.
The separate `.agents/skills/SOURCES.md` provenance draft remains unapplied because PR 2090 owns an overlapping edit.
Its eight-tree, eleven-file metadata update needs owner direction and final-source binding before adoption.

## Pub Pal provider and privacy status

The user approved creating a private agent, connecting the existing 16 authenticated tools, and creating restricted credentials.
The user also approved sending a non-secret technical support request. The request was sent once.
A sent request does not prove provider resolution.
Credentials remain outside Git and chat. This document contains no key, shared secret, auth header, or customer conversation.

The private agent is `agent_2201m4v6qkbgffwb1fg2pjrgn1p6`.
The recorded branch is `agtbrch_5601m4v6qn85fqwbfkng9j72nm9g`.
These identifiers establish intended ownership, not deployed runtime binding.

The existing 14 October 06:18:32 UTC readback returned HTTP 200 for that exact target.
It recorded voice recording disabled, retention `-1`, zero-retention mode enabled, and transcript or PII deletion disabled.
It also recorded 16 tools and Gemini 2.5 Flash Lite. The reasoning property was absent.
No Main-branch attestation was recorded. Configuration readback does not establish deletion enforcement or live isolation.

The source now supports a narrow deletion-only path before environment loading or workspace discovery.
The writer reconstructs only the closed writable projection and preserves unrelated supported values.
It retains optional presence, false, null, zero, array order, model settings, prompts, tools, and opaque references.
Unknown or unpreservable fields cause refusal. Synthetic CLI tests examine the actual serialised PATCH body.
Synthetic missing-Main, non-Main, and mismatch cases require zero PATCH calls.

Official pinned semantics state that privacy settings are agent-wide and shared across branches.
Only Main applies those settings. Publishing another branch discards that privacy change.
A branch ID therefore does not isolate privacy or traffic.

Live hold 191 remains mandatory. The missing capabilities are authorised immutable executing-selector access and scoped remote exclusive-writer proof.
The existing immutable production deployment read matched deployment `dpl_72wRDnp979oNf4kGotREGiKFHZkk` to Git `85512d7bf5c266d6401e7758f1054200429a3f28`.
It exposed no executing environment, agent, branch, or default-selector fields.
Unavailable selector fields do not prove absent binding. Mutable environment or source absence cannot replace immutable runtime proof.
The later availability GET returned HTTP 200 and `available=true`, without selectors or Main semantics.
Availability does not prove zero traffic, privacy isolation, or exclusive ownership.

Reads 068, 070, and 071 are closed. No repeat provider, selector, credential, token, or customer-data probe is authorised.
A future live privacy action needs exact Main attestation, whole-agent traffic isolation, immutable binding, exclusive ownership, and a separate live grant.
Source tests do not satisfy those operational conditions.

## Account, Profile, and native work

An earlier computer-use session restored the existing `.com` account.
The `.co.uk` Google entry returned to canonical `.com` and resumed that account.
No fresh credential entry or OAuth chooser occurred. This proves session return, not a fresh OAuth handshake.

The separately owned Profile PR is [2091](https://github.com/Singularityszn/pubmax/pull/2091), "fix: restore iPhone email returns and You-tab session identity".
Its original run is `01M4VXGBT3QM06QDRYY31J7YA4`.
Its owner retains account callback, session identity, You-tab, and original-account physical email proof.
Its local heavy reservation was released. Remote review or Mail waits alone do not reserve the host.
Profile's post-PR capability gap and physical acceptance remain open.

The historical Launch and Profile comparison found only `knip.config.ts` in their changed-file intersection.
Launch owns menu Escape and generated Android exclusions. Profile owns callback and session repairs plus generated iOS exclusions.
That comparison used historical heads and does not prove final integration.
Whole-branch snapshot replacement can lose either owner's changes.
The eventual combined head needs review, full verification, and real account and device journeys.

Earlier Android work passed a debug build, 28 JVM tests, and two emulator package or system-bar assertions.
The owned emulator was removed afterward. Those checks do not prove search, keyboard, Back, sign-in, or audio usability.
Actual iOS and Android journey acceptance remains open.
Native computer-use APIs were unavailable in the recorded session. Foreign devices were untouched.

## Remaining launch acceptance

The following work remains required before launch delivery.

1. Complete the budget repair through the authorised original decision 201 packet.
2. Resolve the held Night fixture through its supported actor and validate the resulting source.
3. Prove the exact resulting head in an isolated production build with actual grant delivery.
4. Complete conjunctive food budget, dietary, and publisher-calorie journeys with honest counts and missing facts.
5. Restore the Eagle three-scoop fact throughout data, reader, UI, Pal, and replay.
6. Preserve desktop dismissal, nested Escape, five-tab focus, phone layouts, source disclosures, transit, planning, and guest permissions.
7. Prove configured Pal text success, request-specific failure diagnostics, cancellation, retry, and actual provider audio.
8. Prove stored webhook replay against the correlated owner and original question.
9. Resolve immutable binding and Main privacy capabilities before any separately authorised live change.
10. Complete real-account recovery, intended return, sign-out, account switching, and final Profile integration.
11. Complete original-account physical iPhone Mail return and actual iOS and Android usability.
12. Obtain a new owned performance window and run the required map and Plan measurements on valid base and final heads.
13. Complete final-source review, full verification, pipeline publication, PR, CI, and review resolution.
14. Obtain captain decisions for merge, migrations, activation, and deployment where applicable.
15. Keep restaurant coverage, permitted refreshes, identity resolution, and skill provenance as owned follow-up work.
16. Evaluate the venue operator rail before any separately approved subscription implementation.

The nine latest untested product scenarios cover real account restoration, configured text diagnostics, actual SDK audio, correlated replay, live privacy, both native platforms, exact-head production, and formal performance.
Disposable account fixtures and controlled transport cannot replace those cases.
No "10x" performance improvement, whole-host quiet state, production activation, or launch readiness is established.

## Coordination and continuation constraints

The original supervisor owns responses to the launch gate.
The supporting work covered account integration, choice scope, journey inventory, menu data, tooling, voice, focus, fonts, and native seams.
Historical agent names include `auth_integration_readback`, `choice_scope_audit`, `journey_inventory`, `menu_data`, and `tooling_status`.
Those names do not establish that a worker is currently active or owns a new allocation.

The original Firstmate inbox is the existing reporting channel.
A saved or announced note is not an acknowledged decision.
The final decision 199 release note, `1791979741-oW1LMB`, received decision 201 at 12:17:12 UTC.
That reply acknowledges release and authorises the next bounded correction. It does not establish command acceptance.

The current decision 201 execution packet is:

```text
/Users/karanmanoharan/karan-agent-workspace/data/profile-auth-readback-20261014/source174-decision201-execution.json
SHA256 88b8c07e19107e9304b2bb61495fc2d8ffcdacd9d2c49d6e8dbdc3d03a3c81a8
```

The production grant is an existing retained-phase evidence input:

```text
/Users/karanmanoharan/.no-mistakes/evidence/01M4TQ7SJGTFSG7YARX0NT0BGJ/source174-decision201-production-grant.json
SHA256 8a9a060dacecce4a4382c4bc1001849439d94cfd7e67aba840acef982f7e8646
```

The grant covers one original serial software family, with focused, full, and private production forecasts of 2GiB, 10GiB, and 8GiB.
The disk forecast is 16GiB. Residual floors remain 9GiB memory and 3GiB disk.
Capacity must be checked before each heavy phase. A released family is not a new allocation.
Memory percentage times physical RAM is a forecast, not guaranteed free memory.

No new launch run, worker, controller, heartbeat, source adoption, restart, abort, force operation, or foreign signal is authorised.
No provider, native boot, customer, token, deployment, migration, or activation action is covered by this source grant.
The exact original implicit-caller argv may run only after matching custody, head, gate, plan, held fixture, and fresh floors.
A supported refusal must be returned with its actual diagnostic and the preserved source.
No `--yes`, approval, skip, or second response is included.

The repository's [build methodology](docs/agents/build-methodology.md) requires gated publication and forbids direct pushes to `origin`.
The separate documentation request does not permit bypassing launch ownership or starting an unallocated heavy family.
Merge and deploy remain separate decisions. The recorded captain away date is 20 October.

## Evidence index

Local evidence is retained outside the repository. The full paths below are valid on the original machine.
Another machine needs the actual authorised evidence transfer. Missing local files must not become inferred passes.

The review directory is:

```text
/Users/karanmanoharan/.codex/visualizations/2026/10/13/01a133fc-9721-78d2-a149-ea209fa47228/
```

| File in that directory | Purpose |
| --- | --- |
| `acceptance-matrix.md` | Historical 13 October UX matrix and earlier head-specific proof |
| `journey-acceptance-gaps.md` | Historical journey and product acceptance inventory |
| `source174-decision199-final-gate-release-handoff.json` | Exact latest gate, outcome, held fixture, and family release |
| `source174-decision199-configured-full-pass-v3.json` | Configured full pass bound to committed `7ffe9efe` |
| `source174-decision199-configured-verifier-7ffe.log` | Retained executor output, not a rerun |
| `source174-decision199-complete-family-release.json` | Actual owned family release receipt |
| `source174-decision199-durable-selection.json` | Actual once-only decision 199 finding selection |
| `source174-decision199-night-fixture-held.patch` | Preserved uncommitted one-line fixture |
| `pending-original-scope-choice-finding.json` | Wider conjunctive value and publisher-calorie acceptance |
| `pending-food-portion-finding.json` | Eagle three-scoop restoration requirement |
| `choice-scope-audit-3acc899c.md` | Accepted New Inn facts and wider choice gaps |
| `calorie-scope-audit-c919e036.md` | Publisher-calorie limits and lost portion evidence |
| `launch-source-package-proof-cc41.json` | Four manifest and lockfile pins plus package changes |
| `pending-skill-provenance-adoption.json` | Unapplied provenance metadata and overlap owner |
| `auth-integration-readback-cc41-0a16.md` | Historical auth integration seams and required final proof |
| `provider-pinned-update-contract-20261014.json` | Pinned official update input contract, 435 models |
| `provider-private-privacy-main-semantics-supplement.json` | Official Main and shared-privacy semantics |
| `provider-current-readonly-config-20261014.json` | Historical exact private-agent configuration readback |

Selected integrity pins are recorded below.

| Artifact | SHA-256 |
| --- | --- |
| Final decision 199 handoff | `a6187ae135f8beb66532c8156d99729148bd67171e1a3b546fa02285a96c5a78` |
| Configured full pass receipt | `d3131859eccac7d4662d5b2b0ef6abe7ff31995e3c6f0a397fa0167e537ed06e` |
| Held Night fixture | `4923595d6104e2e2b0e1c07999dba885dff165853cc1ec2d7447c2ce9fb56053` |
| Pinned provider update contract | `3673443de6adc846ae7425e19f879af6b4f948c7adc2ff7132f74dd23ea958f2` |
| Main semantics supplement | `dd5ea3e62c0d0f3f5c7d47a9746b56a5176c480b937d61120fa45305cbfb0cb4` |

The latest local product evidence directory is:

```text
/Users/karanmanoharan/.no-mistakes/evidence/01M4TQ7SJGTFSG7YARX0NT0BGJ/live-r7/
```

Its `receipt.json`, `constraint-observations.json`, and `api-responses.json` retain the actual public request results.
Its phone and desktop budget screenshots show the current failure.
Search, menu, profile-focus, and guest Night screenshots retain the corresponding development evidence.
Evidence filenames and test names alone are not proof. Their source head, runtime, assertions, and results define what they establish.

## What this handoff does not complete

This document makes the work understandable to Claude without copying secrets or taking over another owner.
It does not complete the launch goal, close an open finding, waive a test, merge a PR, or deploy the website.
Any later status must name its actual source, evidence level, supported owner action, and remaining acceptance.
