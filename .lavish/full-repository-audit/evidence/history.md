# Historical feature recovery, pinned 04b73e834

Source/history review only. No browser or suites run by this reviewer. File coverage JSON deliberately says partial-source-review, not full-file audit. Feature routes inventory includes 62 page files; existence is not proof of correctness.

## Main result

Date nights, quiet outings, music, gardens and crawls largely survive. Their entry points moved or became conditional. Evidence does not support saying they were all deleted. Dancing has a partial listing capability, but a dedicated dance discovery/ask path was not found. Two concrete deleted capabilities were located, one intentionally superseded.

## Prioritized product findings

### H0: Date night chip routes to heritage for a nonexistent pub

Confirmed production browser defect reported by parent reviewer; current deterministic fallback retains same cause. Product P1: shipped occasion entry does not recommend venues.

Parent clicked Tonight Date night, arriving at `/pal/chat?ask=A date-night pub with some history, calm not loud`. Reply: "I've got the basics but no fuller story on record yet. I won't make one up." Card title became "date-night with some , calm not loud".

`lib/ask/router.ts:275-278` matches the word history using HERITAGE_RE, then `stripIntentWords` at 115-125 strips generic words and treats remaining request as a venue name. `lib/ask/tools.ts:240-265` only resolves names when name is absent; the bogus nonempty string bypasses venue matching. At 279 it produces exactly observed fallback and uses input as card title.

Current main introduced judged routing after production db8be121b, but `lib/ask/routerJudged.ts:40-45` calls same deterministic cascade for no-key, budget, timeout, error and rejected judgments. Diff across those revisions shows no corresponding fix to router.ts or tools.ts. Model routing might rescue some requests; this is not a verified correction. New concierge mood parser does not fix selection of the wrong Ask tool before venue ranking.

Remedy: distinguish generic heritage preference from named-pub history, resolve real venue identity before heritage cards, and test every shipped vibe chip through complete Ask routing/tool path, including keyless and model-failure branches. Validate old production and pinned-main browser independently.


### H1: Occasion discovery moved below listings, then public discovery moved behind Social navigation

High confidence source/history finding; severity product P2, runtime discoverability requires browser proof.

- `app/tonight/TonightClient.tsx:893` explicitly explains placing vibe chips after listings because chips distracted from listings. `:899` renders only ready/empty states. `:925` links Date night to Pal and quiet to Plan.
- Change: `1d676d930` (#1575), "the listings are the answer, so nothing that acts on them stands in front of them".
- `components/nav/navigationModel.ts:29` exposes Tonight, Map, Places, Out, Plan, You. Social lives in More. Change `cde9f7279` (#1655) prioritised first-run loop over Social/Moment.
- Discover consolidation: `5adfb6895` (#765). `app/discover/page.tsx` explicitly describes compatibility redirect to `/social?tab=discover`. `app/discover/DiscoverPageClient.tsx:648-652` still renders Deals, Music and Garden modules.

Recommendation: recover visibility with a small occasion entry point on Tonight/Map/Plan. Reuse existing mood/preset plumbing, preserve intentional list-first design as a conscious choice. Do not restore duplicate routes simply to make discovery easier.

### H2: Dancing browse and ask capabilities differ

High confidence missing capability, not proven historical regression.

- `lib/out/listingKind.ts:49-51` classifies source text including disco, DJ, rave, nightclub as Club night. Added `a28e3f0ed` (#1626).
- `components/out/OutCard.tsx:71` displays that label. `app/out/OutClient.tsx` offers day windows and listing groups, no dedicated dance-kind picker in inspected source.
- `lib/concierge/rank.ts:4-16` has eleven moods, none dancing. `lib/concierge/whatsOn.ts:33-38` recognises club night and DJ set, but not disco/dancing/rave as standalone asks. `lib/concierge/intent.ts:40-51` deterministic mood parser also lacks these.
- Thus "club night" and "where can we go dancing" do not share a deterministic intent contract. A model may compensate, which is not a reliable keyless feature.

Recommendation: unify dance requests with sourced Out listings before adding a venue dance score. Show no verified listings when evidence absent. Acceptance: equivalent dance/disco/DJ asks and browsed Club night rows respect identical date/area/source constraints.

### H3: Date/quiet explanations are heuristic, not measured atmosphere

High confidence structural concern; no claim of fabricated specific venue established.

- `lib/concierge/rank.ts:102-128` derives quiet score from food/history and penalties for sports/music/cocktails. Date score uses cocktails/food/water/history. `:176-187` emits "A calmer fit" and "Good date-night fit".
- `lib/concierge/venues.server.ts:14-15,46-60` normalises unknown amenity booleans to false, losing distinction between absent evidence and confirmed absence for ranking.
- A pub with food/history and unknown music/sports can earn quiet language without actual noise/time evidence. Original concierge `842df301e`; date chip added `80f8488f0` (#424). This is not newly lost code.

Recommendation: label derived fit transparently; do not promise quiet from unknown music/sports. Establish time-scoped noise/space evidence if quiet is a core promise. Acceptance: unknown atmosphere cannot be presented as observed calm.

### H4: Big one tonight means deals on Tonight

High confidence product decision inconsistency, existed at introduction.

- `lib/vibeChips.ts:59-66` has a lively four-person route ask but Tonight action `{type:filter,kind:deal}`.
- `app/tonight/TonightClient.tsx:906-922` executes filter, not stored ask.
- Original `80f8488f0` (#424) had same mapping under old label "On a bender". Current label "Big one tonight" is rewording, not lost route logic.

Recommendation: decide whether chip names an outing or a listing type. If outing, hand off group/lively intent; if filter, name deals. Test same chip's promise across Pal and Tonight.

## Actual historical deletions

| Capability | Evidence | Classification | Recovery decision |
| --- | --- | --- | --- |
| Tonight agent panel, budget/area helper | Introduced `942f7a25f` (#898); deleted `da334c310` (#1278), 811 lines removed including tests; title explicitly says keep one planning entry | Superseded | Keep single composer; port any uniquely useful behavior only after comparison |
| Nearby night-out places API and loaders | Introduced `f32a43454` (#458), expanded `f804e1a3e` (#626); deleted `ab7330827` (#1127) with release-trust cleanup | Removed | Investigate actual demand for food/attraction sequencing; do not restore endpoint blindly |

Reusable contract for deleted places remains `lib/nightOutPlaceContract.mjs`: restaurant, attraction, bar, late_food and near_pub_food/pre_pub_attraction/late_night_bar/crawl_ending_food jobs, London bounds, freshness/provenance checks. Current `lib/lateFood.ts` exists separately. Historical API supplied radius/limit/coordinate-filtered nearby results. Exact deletion rationale beyond broad release-trust commit is unresolved. Any restoration must use current venue types, source policy, freshness and pint/non-pint boundaries; old #626 explicitly kept bars/food out of pub crawl pint logic.

## Retained functionality

- Seven vibe chips remain, including Date night and Quiet pint. Music/sport/quiz/deal chips disappear when inventory lacks matching kinds; honest conditional supply can look like deletion.
- Soft occasions remain: coffee catch-up, alcohol-free outing, chill afternoon. `lib/planOccasion.ts` maps them to tested shipped describe text, currently often fixed London neighbourhood examples.
- Garden weather card, music and deals remain in Discover body.
- Heritage crawl loading and current crawl routes remain. Plan shared links, invite, recap, crews, rounds and profile routes exist; their runtime behavior was not reviewed here.
- First-principles plan explicitly records S1-S4 landed, broadening pints to daytime/food/chill. Current code should be evaluated against that promise, not interpreted as solely a nightlife product.

## Decisions to grill with evidence

1. Should occasion discovery be immediately visible, even if that gives listings less vertical space? Existing #1575 deliberately made opposite choice.
2. Does Date night promise a suitable room, or simply grounded food/history/cocktail preferences? Current model proves second, not first.
3. Is dancing an event ticket/listing job or a pub-with-dancefloor job? Current product has only first in partial form; each requires different evidence.
4. Should quiet mean measured recent noise, absence of scheduled events, or an explicitly labelled heuristic? Unknown music is not proof of silence.
5. Should a friend's night support bar/food/attraction stops, or pub-only routes plus separate endings? #626 deliberately protects pint calculations by excluding non-pubs.
6. Should public gardens/music/crawls live under Social navigation? Current structure mixes public utility and authenticated social functions.

## Roadmap

1. Validate current browser reachability and production supply before declaring recovered code functional.
2. Make derived atmosphere language and missing data honest. Add focused unknown-versus-false tests.
3. Restore occasion visibility using existing chips, preserving user location through handoffs rather than fixed neighbourhood defaults.
4. Unify dance browse/ask intent with sourced event listings, then evaluate dancefloor venue evidence separately.
5. Compare deleted nearby-places flow with current late-food/venue model. Restore only missing user outcomes, not duplicate APIs or panels.

No application changes made. No full-history guarantee: targeted Git history and deleted-path searches establish these examples, not every feature ever committed on every unreachable branch.

## Harness and planning reproducibility audit

Automated inventory is `harness-inventory.json`; semantic review was limited to files listed in coverage JSON. No findings attributed to Claude, Cursor, Grok or any other model: Git/source evidence cannot establish which harness caused product drift.

### H5: Generic PR skill conflicts with project merge authority

`docs/agents/build-methodology.md` requires captain's word for merge and no-mistakes pipeline for pushes. `.agents/skills/workflow-pr/SKILL.md:89-110` instead describes two technical merge gates and then `gh pr merge --merge`, without owner authorization. `.agents/skills/new-branch-and-pr/SKILL.md:16` says simply commit/push. Project instructions outrank generic skills, so this is a latent instruction collision, not evidence of an unauthorized merge. Add a prominent project override or resolve these workflows to the single repo policy. Verify both discovery paths carry same correction.

### H6: Required workflow skills absent from committed discovery roots

Build methodology mandates `/new-feature`, `/code-structure`, `/evidence-driven-testing`, `/before-and-after`, `/greploop` and `/greploop-apps`. None has a SKILL.md under either committed `.agents/skills` or `skills` root at pinned head. Methodology explicitly allows following beats by hand, so work is possible, but exact workflow depends on unpinned external installs. Its install advice uses broad `npx skills add ... -s "*"`. This differs from current global instruction to recover only a missing skill, never an entire collection. Document specific versioned requirements or replace absent playbooks with self-contained local steps. No install performed.

### H7: Duplicate skill discovery paths increase maintenance burden, but no divergent copies found

Git mode/blob inventory: 881 tracked symlinks, including 795 Cursor links. All resolve on audit machine; no absolute symlinks found. There are 227 identical SKILL.md blob groups comprising 454 files. Of direct same-name `.agents/skills` versus top-level `skills` SKILL.md pairs, 209 are byte-identical and zero differ. Cursor README says both roots are loaded; `.cursor/skills/*` links to top-level mirrors. This is redundancy, not proven conflicting content. Do not delete custom skills indiscriminately. Prefer one canonical implementation per skill, relative aliases, provenance/version manifest and a drift check if dual copies remain.

`scripts/link-cursor-skills.mjs` recreates links and can recursively remove an existing destination before replacing it. It was inspected only, not run. Any cleanup must preserve custom entries and have a restore manifest.

### H8: Plan index and current product hierarchy do not fully reconcile

`docs/plans/README.md` indexes nine plans against 23 tracked Markdown files in that directory. It does correctly flag LANDING_ACQUISITION as superseded and desktop parity as parked. But PRODUCT_UTILITY_WAVE remains SHIPPING and says "while Social stays closed", while CREW_NIGHT_LOOP index says Social live by default. These are temporal descriptions without sufficiently clear expiry, not two equally valid current specifications.

`docs/factory/roadmap.md` calls itself current horizon order and places account privacy next, activity history later, B2B later; root AGENTS separately directs extension of PLG_STRATEGY waves rather than parallel roadmaps. Factory vision's broader social ecosystem is compatible with free-drinker/venue-first constitutional rules, but hierarchy across the several sequencing documents is not explicit. The audit did not verify every roadmap status against implementation.

Recommendation: small authoritative decision/status register linking existing plans, recording owner decision date, shipped commit and superseding reference. Avoid another broad roadmap. Mark historical launch/social claims clearly. Preserve useful evidence instead of silently rewriting history.

Positive controls: CLAUDE.md only imports AGENTS.md; area-rule ownership and root-law precedence are explicit. Relative symlink inventory currently resolves. Factory vision retains grounded provenance, free drinkers, free Year in Pints and venue-first revenue. There is useful structure to tighten, not a reason to replace all harness tooling.

## Lockfile and evidence provenance follow-up

### H9: Committed unresolved lockfile conflict, accepted by npm but invalid JSON

Confirmed P2 tooling portability and repository-integrity defect. Introduced in `961e5aea7` (#1746), remains at pinned head `package-lock.json:44-50`. Strict Node JSON.parse fails at line 44. Do not describe this as confirmed npm installation failure: parent ran `npm ci --ignore-scripts` successfully.

Explanation verified from installed npm 11.19.0 source: npm's `@npmcli/arborist/lib/shrinkwrap.js:52` imports `parse-conflict-json` and line 487 uses it. That parser recognises conflict markers and defaults to ours. A read-only invocation on committed file returned root OpenAI requirement `^6.49.0` and PostHog `^1.434.0`. Concrete package nodes resolve OpenAI `7.18.0` and PostHog `1.434.0`; both installed package manifests and `node_modules/.package-lock.json` match those versions. Current package.json requires `^7.18.0` and `^1.434.0`.

Therefore committed document is internally misleading for tools inspecting root lock metadata and fails strict JSON readers, while observed npm installation selects expected concrete versions. No evidence of nondeterministic selection established. Remedy: regenerate clean lock with current package.json under declared toolchain; add strict lock parse/conflict-marker check. Rerun clean npm ci and compare concrete resolutions. Never hand-edit conflict away without lock consistency verification.

### H10: Root review outputs are historical snapshots without embedded provenance

`findings.json` says no stale docs or lint issues; `review-results.json` discusses map bearing changes and concludes low risk. Both last changed in `db8be121b` (#1697). Neither embeds reviewed commit, tool/version, capture time, executed validation or explicit expiration. They are evidence of that review's statements, not evidence current repository is clean. No consumers found in targeted scripts/package/docs search. Move future review outputs to scoped proof directories and include revision/method/limitations. Preserve historic files with an explicit scope label if retained.

### Duplicate artifacts require context, not blanket deletion

Git blob hashes identified duplicated generated snapshots and screenshots. Largest example, memory-remove-polish before/after plaque at 1440 (3.27 MB), is explicitly explained in its README: peek plaque is phone-only, desktop image unchanged. That is legitimate control evidence, not false proof. Versioned `public/data/drink_price_updates/prices_20260821.json` and latest.json are identical 1.91 MB snapshots; food latest/versioned likewise 1.56 MB. This is expected alias-style publication, though storage could be reviewed separately.

More ambiguous: four `docs/proof/sol-tonight-{cache-reload,first-load,offline-cache,reconnect}.png` files share exactly one 1.10 MB blob. Visually identical UI can be valid under cache/reconnect, but static identical images alone prove neither request isolation nor offline behavior. iOS native proof likewise includes identical images named for distinct screens/states. Its README provides simulator/runtime/capture method, but those images must be paired with action/network logs before treating filename as behavioral proof. These are evidence limitations, not accusations that captures were fabricated. No screenshots rendered by this reviewer; comparison is byte identity only.

## Full page-route feature inventory

`route-feature-matrix.md` now covers all 62 tracked page entrypoints. `feature-inventory.json` records each route's imports/dependencies, source redirect evidence, feature group, representative test candidates and explicit untested runtime status. This is a complete page-route inventory, not complete API/job/embedded-component behavior coverage. Test files matched by names are discovery candidates; their assertions were not reviewed or executed in this pass.

Additional capabilities retained in source:

- Account lifecycle: login, signin alias, onboarding, self profile/account hub, public deletion instructions. `/account/delete` intentionally documents authenticated deletion rather than implementing a second anonymous deletion control.
- Profiles/privacy: handles, public/self views, saved lists, follower/following pages, follow link, founder/contributor recognition. Profile source explicitly handles limited private-account cards. Thus factory roadmap's privacy-as-next label requires reconciliation with already present implementation, not automatic creation of a duplicate privacy feature.
- Messaging: inbox/thread surfaces use `authedActionFetch` and `/api/messages`; signed-out gate passed in parent's browser. Signed-in send, media, groups, deletion and privacy behavior remain unverified here.
- Plans/crews/rounds: compose, shared plan, invite token/RSVP, recap, public crew page, who-is-out and rounds by code remain. Parent verified local plan generation/save/vibe. `/rounds` explains code/link entry and points starting action to map; it is not an absent feature.
- Social/media: Social shell, feed/discovery compatibility, Moment, public Pint Drop link, published recap, crawl stories, activity. Media persistence/moderation and account boundaries require full tests independently.
- Venue/heritage/prices: historic detail, landmark, ledger, bar-tab, borough, brand/category, soft drinks, Spoons and Pint Index editions remain. Public-page existence does not prove data is fresh or adequately dense.
- Admin: `app/admin/page.tsx` reads headers and calls `canOpenAdminDocument` before `AdminClient`, with unauthorized response on failure. This verifies document gate structure only, not API permissions.
- Native/PWA: Capacitor config uses remote production site, optional sync-time local URL, bundled offline fallback; service worker documents versioned static/data cache and no API interception. Native parity cannot be inferred from browser success.

Evidence-backed aliases: `/profile` redirects `/u/you`; `/signin` redirects `/login`; `/drinks` is a permanent redirect fallback owned centrally by next.config; `/discover` is documented compatibility shell. These are superseded addresses, not deleted underlying user outcomes. Other historical removals remain bounded to previously traced items; no blanket recovery claim added.
