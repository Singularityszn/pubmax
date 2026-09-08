# Astra.md: PUBMAXX, everything built from 3 to 7 September 2026, and what comes next

Current PlanAstra: [docs/plans/PlanAstra.md](docs/plans/PlanAstra.md). It reconciles the fleet draft with the deployed 7 September baseline.
Its decision table supersedes the older PlanAstra recommendations below. Historical measurements and deployment statements below retain their original dates.

Written 7 September 2026, 13:30 BST, by the firstmate orchestrator (Claude Fable 5.1) for Astra. This file is the complete handoff: why the product exists, what was built, how the work was run, which skills and tools were used, what the live site does today, and what to build next. Read it top to bottom once, then use section 14 as the index.

The captain is Karan. He talks to one orchestrator, the firstmate, which delegates every piece of project work to workers and merges their pull requests. Nothing in this file was written from memory alone; every figure has a source in the repository, a pull request, or a report named in section 14.

Production right now: https://pubmaxxing.com serves `main` at `74e688913` (Vercel deployment `dpl_8Cz4fvuUqLbQoQLndnQnEDDFDxES`, project `chengdu`, team `pubmax69`), deployed 08:37 BST today. Migrations through `0152` are applied on the production Supabase project `iankajxliutqogqkmvdg`. Zero open feature pull requests. One docs PR (#1611, the AGENTS.md split) is green on fourteen checks and red on one noisy performance check, waiting on the captain.

---

## 1. Why we are building this

The captain's north star, in his words (4 September): software is built for agents now, so people can go out and spend time with their mates, build friendships and relationships, and enjoy drinking; PUBMAXX gives them new places to discover, the cheapest price for any drink, trending spots, and whatever else we can imagine.

The USP, in his words (7 September): "speed, performance, design and customer onboarding and our /taste-skill /unslop are our USP". Every lane is judged on those four. UI work runs the taste and unslop skills before it ships.

The product (PRODUCT.md): PUBMAXX (the brand) and PUBMAXXING (the app) help people discover pubs and plan pub crawls using pint prices, location, and venue context. Users are friends planning a night out in London, two to six people deciding where to go for pints tonight. The primary job: turn "where shall we go?" into a concrete Plan of Stops at real Venues, with Friends invited and a Route they can follow. Vocabulary is fixed: Plan, Stop, Venue, Friend, Route. Colour encodes state, never new objects.

The stance (CONTEXT.md): pro-experience, pro-connection, pro-choice, without pressure or excess. Playfully anti-capitalist, operationally pro-joy. Prices are shown with honest trust: green means confirmed within 30 days, amber means listed from a permitted first-party or chain menu with a source URL and capture date, estimate means modelled and always labelled "est." with a method link.

Release decisions (3 September grilling, binding for the month): web relaunch for London plus iOS and Android store submission this month; UK prices as a separate city-by-city track; value first, the account prompt at the first action worth keeping; release metric is the share of visitors who take a first action within 60 seconds; Monzo and Revolut for clarity of one primary action per screen, not their look; PUBMAXX identity and kickers stay; no AI-template patterns anywhere; p75 LCP under 1.5 s on landing and map on a throttled 4G rig at 390x844, 2.5 s elsewhere ratcheting down; map pin-ready under 2.5 s.

The end goal (4 September): keep building until the mobile app exists for iOS and Android, store-ready. The captain creates the Apple Developer and Google Play accounts and submits. Native code exists today (Capacitor 8 remote-URL shell over the web app, `ios/` and `android/` projects, `docs/STORE_READINESS.md`).

---

## 2. Where we are now, in numbers

| Thing | State on 7 September 13:30 BST |
| --- | --- |
| Production | `74e688913`, deployed 08:37 BST, 24 PRs since the previous deploy `1d676d930` (02:25 BST 6 Sep) |
| Deploys this cycle | 3 Sep 18:35, 5 Sep 05:25, 5 Sep 22:45, 6 Sep 02:25, 7 Sep 08:37 |
| PRs merged 3 to 7 September | about 190 (#1331 to #1606), every one squash-merged by the firstmate on the captain's standing authority |
| Unit tests on main | 1,507 files, about 16,100 tests, green on Node 26 |
| E2E specs | 216 Playwright spec files; browser law pins and a full browser suite in CI |
| CI | GitHub Actions on Avrea runners (`avrea-ubuntu-latest-2-vcpu`; perf and UX-lane jobs on 4 vCPU), 15 checks per PR, all required to be green before merge |
| Migrations | 0123 to 0152 applied on production; none pending |
| Price data | 4,355 bundled price rows over 3,233 venues; 385 pubs with a real dated price; 1,395 listed rows; 2,788 re-collected pint rows; 806 Wetherspoon pubs with a value-per-tenner lens (SpoonMe import) |
| Cities | London priced; Manchester, Birmingham, Leeds, Bristol night areas derived from OSM, no prices |
| Native shells | iOS and Android build and boot from one command each (`npm run ios:run`, `npm run android:run`); reviewed on both rigs (#1599); store paperwork written; store accounts not yet created |
| Accounts | about eight real accounts; founding numbers 9, 11, 12, 13 retired by test accounts |
| Fleet home | `~/karan-agent-workspace` (firstmate 7dcf072); project clone `projects/pubmax` -> `~/Documents/projects/pubmaxx`; worktree pool `~/.treehouse/pubmaxx-bde241` (20 slots) |

---

## 3. How the work is run

### 3.1 The shape

One orchestrator, the firstmate, runs in a Claude Code session on Claude Fable 5.1 inside a Herdr terminal workspace. The captain speaks only to it. It never edits project code itself. For every piece of work it:

1. Files a backlog item (`tasks-axi add <id> "<title>" --kind ship|scout --repo pubmax`).
2. Writes a brief at `data/<id>/brief.md` from a scaffold (`bin/fm-brief.sh <id> pubmax --mode direct-PR` or `--scout`), filling two sections: the captain's intent in his own words, and the firstmate's build spec.
3. Spawns a worker in an isolated git worktree (`bin/fm-spawn.sh <id> projects/pubmax --mode direct-PR --yolo on --harness claude --model claude-opus-5 --effort high`, or `--scout`). The worker is a fresh Claude Code (or Codex, Grok, Cursor, OpenCode) session in its own Herdr pane with the brief as its first message.
4. Supervises through a watcher: workers append sparse status lines (`working:`, `done:`, `needs-decision:`, `paused:`, `blocked:`) to `state/<id>.status`; the watcher wakes the firstmate on each; the firstmate steers with `bin/fm-send.sh <id> "<text>"` (a durable inbox record plus a doorbell in the pane).
5. Records the PR (`bin/fm-pr-check.sh <id> <url>`), verifies the merge bar, merges (`bin/fm-pr-merge.sh <id> <url> --squash`), and tears the lane down (`bin/fm-teardown.sh <id>`), which refuses if the worktree holds unlanded work.

Two kinds of worker: a ship lane produces a PR; a scout produces a report at `data/<id>/report.md` and never a PR. Scouts did every review, audit, verification, and research task in this file.

### 3.2 The merge bar (as of today)

- Base `main`, mergeable, not conflicting.
- Every Avrea CI check green: production build, lint and typecheck, unit tests (4 shards), coverage, RLS session tests, browser law pins, full browser suite, performance budget, UX lane performance, release scope, design law pins, migration proof when a migration rides.
- Commit authors only `31683167+karanmrn@users.noreply.github.com`. No `Co-Authored-By` or `Claude-Session` trailers (Claude Code injects them; workers strip them with `git filter-branch --msg-filter` and force-with-lease on their own branch).
- Never merge red. Never raise a performance ceiling inside a PR. A red check proven to be runner noise with interleaved A/B evidence may be re-run once on the captain's word (done twice today).
- Migrations run only on the captain's word "apply <n>", through the Supabase MCP connector, never in the same breath as the merge.
- Deploy only on the captain's word, from a clean shallow clone of main linked to the `chengdu` Vercel project: `node scripts/deploy-vercel.mjs --prod --scope pubmax69 --yes`.

Before 6 September 16:37Z the GitHub Actions org billing had lapsed, so every check failed in two seconds and the bar was the local bar (changed-file ESLint 0, typecheck, full unit suite 0 failed, diff-check, data validation, Postgres proof). About 90 PRs merged on that bar. Avrea runners (#1585) restored CI; #1589 made every job green; #1598 made the performance gate strict on push and PR.

### 3.3 Models and routing

- Orchestrator: Claude Fable 5.1 (falls back to Opus 5 xhigh when the Fable allowance is low).
- Ship workers: Claude Opus 5 at high or xhigh effort for hard work, low for mechanical; Fable 5.1 high for UI and design lanes when its quota allows; Codex gpt-5.6-luna xhigh and Grok 4.6 were used until their weekly windows emptied (4 September); Cursor at 0 percent until 16 September.
- Memory rule on the 24 GB Mac: check `vm_stat` free plus inactive before every spawn; floor about 7 GB; ten workers at once was the practical ceiling; an Android emulator or a local OCR model wires 8 to 16 GB and must be counted.

### 3.4 Delivery modes

Every ship lane today ran `direct-PR` with `yolo on`: the worker pushes and opens a PR, the firstmate merges when the bar is met. The project's standing posture is `no-mistakes` (a separate review pipeline); the deviation was an intake judgment under the captain's "merge everything, go nuts" with the 15-check Avrea bar as the gate, recorded on every backlog item.

### 3.5 Captain laws that shaped every decision

From `data/captain.md`, all binding:

- Speed is the defining factor. Performance ceilings only ratchet down. Viewport-first progressive loading on heavy surfaces.
- Never merge red. "Nothing should ever be red."
- Price colour law: red is expensive, yellow is average, green is cheap, relative to the area. Trust is shown by label or badge, never by colour.
- Buttons follow one system (primary, secondary, ghost), one height, one radius, centred labels; anything off-centre is a defect measured with the DOM.
- Kickers above headings are brand.
- No CI secrets and no keyless auth bypass seams in tests.
- Raw viewer coordinates never in a URL or a shared cache key.
- Anonymous check-in and anonymous Wanted saves stay allowed.
- Migrations and deploys on the captain's word only; one deploy a day unless he says otherwise.
- Never tear down unlanded work.
- No synthetic traffic loops against production (the Vercel firewall challenges an IP after about 250 loads in 15 minutes).
- Compact the orchestrator's context at about 140k tokens.
- Never add an agent as a commit co-author.
- Never use a Claude limit reset without the captain's decision.

---

## 4. Timeline, day by day

### 3 September (new Mac, fleet reconstructed)

The captain moved to a new 24 GB Mac. The firstmate home was rebuilt (firstmate 7dcf072), `data/captain.md` reconstructed from `setup.md`, `sol5g.md`, `fable52.md`. Harnesses signed in: claude, codex, cursor-agent, grok, vercel. The 3 September grilling fixed the release decisions in section 1. Production deployed at 18:35 (main 27ab4c1, #1339). Late evening the captain said "yolo on the local bar, merge all, go nuts": the Grokbot audit split (#1342 to #1348), crew nights (#1349), price-pair withdrawal (#1350, migration 0139), AGENTS.md trim (#1353), PubMap decomposition (#1355) landed.

### 4 September (69 PRs)

Morning: design wave 2 (#1402, every launch route on the Screen primitive with one primary action, 197 files), seven browser reds fixed (#1403 to #1410), /u/you and /pal copy painted from HTML (LCP 1,556 to 764 ms and 1,388 to 524 ms, #1411), every route ceiling ratcheted to measurements (#1416), borough server render 117 to 10 ms (#1420), /u/you back under ceilings (#1421). Migrations 0137, 0139, 0140 applied at 11:20 on "Apply all the migrations".

Midday: the UK price crawl (#1431: 7,573 hosts, 17,019 pages; 3,209 hosts publish no price), the Wayfinder map #1423 for the v0 trust and freshness cut (decisions taken on "go with what feels best": a lone Pint Drop is "logged once, needs a second drinker"; the July dataset is named a snapshot; seeded demo drinks leave production), and its five core tickets (#1432 to #1443). Strix pentest: 0 validated vulnerabilities across 15 surfaces. The first preview verification passed (verify-preview-2).

Afternoon: Pub Pal mascots rendered as a family (fox, pigeon, badger, corgi; #1449), PDF drinks menus read (820 PDFs, 389 rows, #1451), iOS capabilities and privacy manifest (#1452), context.dev wrapper (#1453), Android shell (#1454), soft-launch runbook (#1457), night areas for four more cities (#1461), landing variant B with the answer card (#1468), iOS simulator build in one command (#1470).

Night: "Go nuts with as many agents as memory allows, v0 by tomorrow and hopefully the iOS and Android app." Ten workers at once. The mobile gap audit (20 ranked gaps; hard App Store blocker: no in-app account deletion). GitHub Actions went down for billing at 21:29Z.

### 5 September (68 PRs, two deploys)

Night into morning: Android builds and boots (#1474), consent card holds a lane on onboarding (#1475), offline and share sheet and client error report (#1476), six native config gaps (#1477), pint dataset re-collected from source (#1480), PDF lane on main (#1479), account deletion door and legal row (#1482, the store blocker), price loop at 390 (#1483), store review prompt (#1485). Production deployed 05:25 (e8dfd8dbe) after verify-preview-3 passed 12 of 12.

Morning laws: "I'm not paying for GitHub, you do the CI checks." The captain was angry about UI bugs: "The alignment, buttons and ui is fucking ugly. I need fable 5.1 to fix everything today." Fable 5.1 lanes took the story sheet, messaging UI and speed (Instagram-DM feel; send 491 to 204 ms tap to bubble), the UI sweep at three widths (#1508, 212 files, 68 proof shots), the second-drinker confirm path (#1492), the price colour law from one module (#1499), trust read path (#1495), tile outage retries (#1494).

Afternoon: plan integrity (#1512, #1513, #1519, #1521), permission matrix tests (#1520; found a removed plan member kept table-level SELECT), accessibility pass (#1524), the four loop analytics events (#1526), night signal candidates (#1527), photos fit the wire (#1547), account deletion made real under the storage guard (#1548, migration 0145), half-pint integrity (#1551, migration 0147). Migrations 0141 to 0147 applied at 19:04 and 19:44. Captain answered five held calls (robots HTML hosts, CDN document widening, contribution age rule, drink price snapshot, support address) and each shipped within the hour (#1552 to #1556).

Evening: verify-preview-4 said DEPLOY; production deployed 22:45 (d6db5e83d). Then "Opus 5 for everything remaining" and the three reviews were ordered: merged-code review (2 P0, 11 P1, 23 P2), thermonuclear review (3 P0, 6 P1, 10 P2), codebase design review (2 P0, 8 P1, 5 P2). Every P0 and P1 was fixed the same night (#1559 to #1575): DM realtime topics made private (#1567, migration 0148), the one-tap price door asks the measure (#1570), one Postgres test harness that cannot skip silently (#1572), three CI-only feature flags deleted and their behaviour shipped (#1573), deletion collects keys then auth then storage (#1574), paid route budgets trust only the platform IP header (#1564).

### 6 September (early: deploy; day: plan; night: Avrea and the merge train)

02:20: the captain applied 0148 to 0151 ("Apply all of them"), verify-preview-5 said DEPLOY, production deployed 02:25 (1d676d930). One finding from the production controls became #1582 (thread channel admits its own participant, migration 0152). The captain restarted the Mac; a two-day briefing was written for Astra (the earlier `data/reports/Astra.md`, now superseded by this file).

Day: the plan-astra scout (Fable 5.1) did the deep review of the live website through a Wayfinder map (#1576, tickets #1577 to #1581): every button counted (fifteen button style families), the "weird price button" identified as the rotated bevelled PriceBadge, text routes at 1.2 to 1.5 s LCP on Slow 4G, the map at 8.5 s to a first pin and 18 MB decoded on `/map?sel=`, the social inventory (21 families, 8 accounts). Output: `data/plan-astra/report.md` and `data/reports/PlanAstra.md` with ten captain decisions D1 to D10 and a five-wave roadmap. At 17:00 the captain pasted Astra's delta audit (F01 to F12) and said "I want the landing pages to show the pictures of London." Six lanes spawned at once for F01 to F09 and F12.

Evening: the captain installed Avrea; PR #1585 moved every workflow to Avrea runners. The first real CI run since 5 Sep 11:08Z showed two real failures hidden by the outage (production build refused the process-memory store fallback from #1569; the ratchet script lacked fetch credentials) and the map over its own request ceiling. The `ci-green-on-runners` lane fixed both and carried the map fix (#1589, /map 335 to 123 requests, first tappable pin before the entrance ramp). The captain's orders at 20:45: merge Avrea, forget billing, apply 0152, review everything, "go nuts". "raise drinks" set the /drinks ceiling 400 to 1000 (it is a permanent redirect). The captain typed a task into a worker's pane: scrape SpoonMe (806 Wetherspoon pubs by units per 10 GBP) onto the map; it shipped as #1596. Starred repos triaged (677 stars; the skill layer was already saturated at 2,986 skills; the gap was tooling). In-depth performance review ordered and delivered.

Night: the merge train. Fifteen PRs merged between 22:00 and 04:00, every one on 15 of 15 green checks: #1589, #1594 (five mobile obstructions at 390), #1598 (/pubs prefetch-on-sight fix, strict budget gate, four perf wins), #1583 (analytics environment and release on every event), #1584 (city enrichment retry proof), #1586 (permission matrix 28 to 55 cells), #1597 (Fable design review of five surfaces at four widths), #1588 (London photographs on the landing pages, nine Wikimedia Commons images with attribution), #1595 (knip dead-dependency gate in verify), #1590 (venue truth contract: stated, unknown, derived), #1587 (Today honesty: location disclosure, quiet intent, Pub of the day gate, /plan metadata), #1591 (price plaque is a plain figure), #1592 (desktop Core Web Vitals row), #1596 (SpoonMe lens), #1599 (iOS and Android shells reviewed on both rigs). The captain's /gnhf ask: two extra Fable 5.1 agents on web design and on iOS and Android; both ran and completed (REPORT.md under `docs/proof/design-review-fix-web/`). Three review scouts ran over the night's merges. Their findings became four fix lanes.

### 7 September (morning: fixes, verification, deploy)

04:00 summary delivered by push notification. Fix lanes merged: #1600 (heavy-route links no longer prefetch on sight), #1602 (seven review housekeeping rows), #1603 (P0: the map key printed a pint band over the Spoons units lens), #1601 (production check first, an IPv6 literal is an address, amenity status is the wire's answer, a contact is what parses). A verification scout built a production-environment preview of main, walked every route, proved the two fixes at runtime, checked migrations, and returned SAFE TO DEPLOY. The captain: "Deploy to vercel once green, I want to see how the new mobile and desktop ui is", then "lets finish all of them together and deploy once". Three UI lanes ran: consent card only after the first answer, docked above the tab bar (#1604); desktop map Filters control at 641 px and up (#1606); one button family in the profile editor, one number-square chip, a 4+1 price chip ladder at 390 (#1605). Both UI lanes applied the taste-skill and the unslop checklist to their diffs before final. Two false reds from the performance gate on untouched routes (/crawls 320 vs 300; then /today and /onboarding on a docs-only PR); the captain: "option 1, nothing should ever be red". Deployed 08:37 (74e688913). The AGENTS.md split into a per-area tree (#1611) is up. Tools and skills updated (no-mistakes 1.64 to 1.69, opencode repaired). The skill security scan finished (2,986 skills; 357 static do-not-install flags, needs a human read).

---

## 5. Everything built, by theme

### 5.1 Speed and the gate

- Every route the site serves a stranger has a budget in `perf/route-budgets.json` (server render, decoded JS, requests, LCP), seeded from measurement on 4 September and ratcheted down since. `scripts/check-budget-ratchet.mjs` refuses a raised ceiling without a recorded reason. The Playwright gate `e2e/performance-budget.spec.ts` runs on push and PR on 4 vCPU Avrea runners with 5-sample medians.
- Wins: /u/you and /pal painted from HTML; /borough 117 to 10 ms; static assets leave the proxy; /today third-party lanes bounded; map secondary streams held until pins paint (first tappable pin 15.6 to 10.7 s cold, then the entrance ramp removed); /map 335 to 123 requests; /pubs prefetch-on-sight removed; a heavy-route Link is not prefetched on sight; CDN-cached documents widened to /tonight, /today, /near.
- Core Web Vitals baseline recorded for phone and desktop (`perf/cwv-baseline.json`).
- Known state: text routes paint in 130 to 500 ms on production; the map is the whole problem (first tappable pin about 10 s cold under Slow 4G with 4x CPU; 1 MB MapLibre chunk; whole-city price bundles on the sheet). The gate's four noisy routes (/today, /discover, /drinks, /crawls) show 37 to 51 percent spread on the runners and produced two false reds today.

### 5.2 Prices, trust, freshness

- UK crawl of every permitted pub website, PDF menus, and scanned menus (olmOCR on Apple Silicon, no GPU). Bundle read through one precedence seam with freshest-then-cheapest rules.
- Trust story from one module (`lib/pintTrust.ts`): listed, logged once, confirmed, estimate, snapshot; "No price yet" never stands over a public drop; a lone drop gets its own lane and a second-drinker door; a priced drop needs a verified actor; an anonymous drop still counts as one account.
- Price colour law from `lib/priceBand.ts` (London terciles: cheap 5.15 and under, average 6.15 and under, expensive above).
- Half pints off the pint lane (measure column, migration 0147); the one-tap price door asks the measure.
- The July dataset and the per-drink lane are declared static snapshots and say so; the pint bundle was re-collected on 4 September (94 percent re-read, 2 percent changed).
- SpoonMe value lens: 806 Wetherspoon pubs by units per 10 GBP, imported with provenance (788 of 805 matched to pins).
- Retention on deletion: prices stay, the account is remembered as "a PUBMAXXER" (migration 0150).

### 5.3 Map

- PubMap decomposed; camera idle orbit removed; gesture guard; compass; tile outage retries silently; a blocked map library still gets the reader to the venue; deep links show the pin they name; no empty frames on the sheet; the tablet sheet publishes its own offset; the desktop Filters control from 641 px; the map key follows the active lens.

### 5.4 Landing, Today, Tonight, Out, Near

- Landing variant B: the answer card, "Still £X?" into the Pint Drop composer holding £X, the Pal second door, a three-row rail; London photographs with attribution on every landing family page; the price plaque is a plain figure.
- Tonight: listings first, head actions below; one dated sentence from the live read; lede fence by source label; one tap from the mobile home.
- Today: four typed picks states; location disclosure matches the privacy page; the quiet door carries intent; Pub of the day needs a sentence of fact.
- Out and Near: unlisted-places notice only when it is the answer; attribution as a footer.

### 5.5 Design system and UI

- Every launch route on the Screen primitive with one primary action. One button token row (`--control-*`), one button family, one number-square chip, a deliberate 4+1 price chip ladder at 390. Kickers stay. Candle Coral light, Night Out dark (DESIGN.md).
- Sweeps at 390, 768 and 1440 with before and after proof shots under `docs/proof/`; the Fable design review of every web surface at four widths (`docs/proof/design-review-fix-web/REPORT.md`).
- Consent card: appears once per screen, holds a lane on native onboarding, and since #1604 appears only after the reader's first answer, docked above the tab bar; one control per screen.
- Accessibility: keyboard and screen-reader pass through the core loop with axe fences.

### 5.6 Social, plans, messaging

- Messaging reads like Instagram DMs: thread list, full-screen thread, bubbles, composer pinned above dock and keyboard, optimistic send, read and typing state; send is one request with a server broadcast; DM topics private under RLS (0148); one send is one message (client_message_id, 0149); a thread channel admits its own participant (0152).
- Plans: a Plan may be one pub; the route editor opens on the stored route; capability-driven reads; live invite tokens in every share; the member projection on by default (three CI-only flags deleted).
- Permission matrix as anon, A and B at the API and table doors, seven roles, 55 cells; a removed member no longer keeps table-level SELECT (0144).
- Night signal candidates stored pending, advanced only by a person (0146).
- Loop analytics: the four loop moments emit; every event names environment, release and schema version; the north star and tracking plan are written (`docs/analytics/`, METRICS.md).

### 5.7 Native shells and store readiness

- Capacitor 8 remote-URL shell; iOS and Android build and boot from one command; camera plugin, push and associated-domains capabilities, privacy manifest, export compliance key, portrait-only iPhone, back and warm re-entry, allowBackup off, ink splash, monochrome notification icon, store review prompt after a kept action, offline on every route, OS share sheet, account deletion in-app, legal row, one sign-in.
- Reviewed on both rigs (#1599): launch screen, safe areas, splash, keyboard, sign-in, share, OS text size; iPhone-only v1.
- `docs/STORE_READINESS.md` (61 KB): ASO copy in `lib/storeListing.ts` under test, category, age rating answers, privacy labels, screenshot shot list, icon and splash set, local verification without accounts, and section 8 "Owner-only remaining steps" (enrolment, Team ID, APNs key, Play closed test with 12 testers for 14 days, the support mailbox).

### 5.8 Security and correctness

- Strix pentest (0 validated vulnerabilities), an authenticated pentest on an isolated Supabase project, every inline script through one hardened serializer, paid-route budgets per lane trusting only the platform IP header, harvest allow-list checked at the landed URL and refusing IPv6-mapped metadata addresses, production guards ordered so the production check comes first, the venue API ships a truth contract (contacts only when they parse, blank amenities unknown), the store seam refuses a production memory fallback, one Postgres harness that throws when Postgres is absent, deletion collects keys then auth then storage.

### 5.9 Ops and data

- `/api/version` names the built commit on CLI deploys; a production-environment preview in one command (`npm run deploy:preview:prod-env`, refuses `--prod`); city enrichment cron with durable checkpoint, lease, bounded retries, jitter and a queue-age metric; freshness registry honest about snapshots; static prefixes proven by bytes; knip in verify; every loop event attributed to its environment.

---

## 6. Skills

### 6.1 Skills the firstmate itself invoked

Firstmate internal skills (from `.agents/skills/` in the fleet home): `harness-adapters` (before every spawn, trust dialog, interrupt, exit, relaunch), `ask-user-authority` (every worker decision), `captain-hold-lifecycle` (every investigation's captain calls), `stuck-crewmate-recovery`, `secondmate-provisioning`, `project-management`, `process-event-sources` (custom check scripts such as the timed 04:00 wake and the CI-green watch), `diagnostic-reasoning`, `quota-array-dispatch`, `bootstrap-diagnostics`, `stow`.

User skills invoked in this session: `ideate` (panel of skeptic, builder, differentiator as fleet scouts), `gnhf` (companion mode for the overnight design and mobile lanes), `goal-loop` (the store-ready objective), `wayfinder` (maps #1354, #1423, #1576), `grilling` and `domain-modeling` (the 3 September release decisions, ticket #1580), `last30days` (research setup), `rename`, `compact` and `strategic-compact` (context management at about 140k), `taste-skill`, `unslop` and `impeccable` (UI passes), `design-review`, `setup-pstack` (Claude-only model roles in `~/.cursor/rules/pstack-models.mdc`), `performance-review` and the thermonuclear, codebase and code review skills (as scout briefs), `remote-mac` (Remote Control), `afk` (away mode), `updatefirstmate`.

### 6.2 Skills workers used inside lanes

Workers read the project's committed skills under `skills/` and `.agents/skills/` (mirrored in the repo, catalogued in `INSTALLED_SKILLS.md`): the design packs (impeccable, taste-skill, ui-ux-pro-max, hallmark, refactoring-ui, anti-ui-slop, design-taste-frontend, stitch-design-taste), superpowers (brainstorming, test-driven-development, subagent-driven-development, systematic-debugging), Matt Pocock's skills (grilling, wayfinder, domain-modeling, adr), the Vercel agent skills (react and Next.js best practice), Cloudflare and Supabase skills, the caveman compression skill, the cursor plugins (thermos, ralph-loop, orchestrate), the marketing and SEO packs (OpenSEO), gstack (autoplan, review, qa, benchmark, investigate), the printing-press CLI skills, no-mistakes (the validation pipeline, used in earlier waves), Playwright and chrome-devtools-axi for browser proof, lavish-axi for review boards (the mascot and landing hero boards).

### 6.3 Installed packs (2,911 skill directories tracked in `~/.agents/.skill-lock.json`, 2,986 under `~/.claude/skills`)

Largest sources: `karanmrn/karanagentskills` 2,207 (the captain's own archive), `skills-101/superpowers` 81, `bergside/awesome-design-skills` 66, `davidondrej/skills` 59, `coreyhaines31/marketingskills` 49, `cursor/plugins` 43, `genmedia-labs/skills` 33, `mattpocock/skills` 29, `warpdotdev/common-skills` 26, `addyosmani/agent-skills` 25, `anthropics/skills` 20, `dzhng/skills` 20, `OutThisLife/brooklyn-skills` 20, `coreyhaines31/makerskills` 20, `JuliusBrussee/caveman` 20, `cloudflare/skills` 13, `obra/superpowers` 13, `Leonxlnx/taste-skill` 13, `ScrapeCreators/social-media-research-skills` 12, `emilkowalski/skills` 12, `gnurio/refactoring-ui-plugin` 11, `jakubkrehel/skills` 11, `AI-Builder-Club/skills` 10, `every-app/open-seo` 10, `mvanhorn/cli-printing-press` 9, `vercel-labs/agent-skills` 9, `kunchenguid/grok-ship` 7, `nextlevelbuilder/ui-ux-pro-max-skill` 7, plus gstack, graphify, gnhf, axi, chrome-devtools-axi, gh-axi, diagram-design, drawio, design.md, shadcn, ponytail, autonnel.

Claude plugins: ecc (everything-claude-code 2.2.1), compound-engineering 3.24.0, caveman, openai-codex.

### 6.4 Tools installed this cycle

CLIs: `gh`, `herdr` 0.8.2, `treehouse`, `tasks-axi` 0.2.5, `gh-axi`, `quota-axi`, `lavish-axi`, `chrome-devtools-axi`, `gitnexus` 1.6.11, `backpass`, `no-mistakes` 1.69.0, `codex` 0.153.4, `opencode` 1.18.29, `pi` 0.73.1, `grok` 1.0.13, `cursor-agent` 2026.09.02, `bun`, `uv`, `skillspector` 2.11.0, `hunk`, `sentrux`, `entire`, `alph`, `dbx`, `openwiki`, `zg` (zvec-grep), `obscura`, `strix` 1.6.2 (with colima and docker), `llama.cpp` with olmOCR weights, PostgreSQL 16 and postgrest, Xcode 26.6, Android command-line tools, Temurin JDK, `yt-dlp`, `vercel` via `npx`.

MCP servers: gitnexus, context (context.dev), mobbin, flint-chart, codebase-memory, openseo (OAuth pending), plus the claude.ai connectors (Supabase, Vercel, PostHog through the wizard, Gmail, Slack, Notion, Stripe, ElevenLabs).

Keys live in `data/keys.env` (mode 600), never in chat: context.dev, ScrapeCreators, OpenRouter, PostHog (in Vercel env), Supabase pentest project.

### 6.5 The skill security scan

SkillSpector static scan of all 2,986 installed skills (7 September): 2,309 caution, 357 do-not-install, 311 safe, 959 with at least one critical or high finding. Nearly all are pattern matches on Dockerfiles, changelogs and docs of video, image and crypto skills. A few deserve a human read (ad-creative flagged for anti-refusal prompt patterns; the gitnexus-plan and gitnexus-work skills). Nothing removed. Report: `data/audits/2026-09-07-skill-scan/README.md`.

---

## 7. How tasks were given to workers, with examples

### 7.1 The brief

`bin/fm-brief.sh` scaffolds a brief with the worktree-isolation assertion (stop if launched in the primary checkout), the status protocol, the delivery mode's definition of done, and two blanks. The firstmate fills them:

- `## Captain's intent`: the captain's ask in his own words plus only the context needed to read it. Example (consent card): "Captain's standing ask (PlanAstra, accepted): 'the primary asks before it gives' is wrong; the product answers first."
- `## Firstmate spec`: what to build, in order, each its own commit; the tests that pin it; the proof (screenshots at named widths into `docs/proof/<lane>/`); what not to touch; the commit rules (author, no trailers); and the status lines to append and when. Since today every spec also says: apply the unslop checklist by hand (the skill refuses tool invocation) and run taste-skill on UI diffs.

### 7.2 The spawn

`bin/fm-spawn.sh <id> projects/pubmax --mode direct-PR --yolo on --harness claude --model claude-opus-5 --effort high`. The spawn moves the backlog item to in flight, takes a clean pooled worktree, opens a Herdr pane, launches the harness with the brief. Scouts: `--scout`. Fable lanes: `--model claude-fable-5-1`. Model ids must be full (`opus-5` alone launches and then idles with the brief unread).

### 7.3 Supervision

The watcher turns status appends and turn ends into wakes. The firstmate drains the queue at every wake, reads only what changed, and acts: steer (`fm-send`), answer a keyed decision (`fm-send --resolve-key <key>`), nudge an idle pane, exit a finished worker (`fm-control exit`), relaunch to rebase (`fm-control relaunch`), or leave it. Workers that poll CI in background shells produce a wake per poll, so the standing steer is: stop polling, append `paused: waiting on CI, idle`, end the turn; the firstmate watches CI with a custom check script and merges on green.

### 7.4 Decisions

A worker never answers its own question. It appends `needs-decision: [key=<k>] ...` with options and evidence. The firstmate loads `ask-user-authority`, decides anything unambiguous toward the accepted intent, and escalates only genuinely ambiguous, expanding, or destructive choices to the captain with five elements: the requirement, the proposed expansion, the smallest compliant alternative, the consequences, a recommendation. Examples today: the /crawls perf red (escalated: one-off re-run vs method fix; the captain chose the re-run and "nothing should ever be red"); the unslop skill refusing tool invocation (decided: apply its checklist by hand).

### 7.5 Parallelism and memory

Ten lanes ran at once on the night of 4 to 5 September. Overlap on files was never a reason to wait; each lane rebased onto main and re-ran CI. The real limits were memory (an emulator or an OCR model wires half the box) and the Claude five-hour session window, which stalls every Claude worker together and silently (the panes read idle).

### 7.6 Merge and teardown

The firstmate verifies the bar itself (`gh pr view --json mergeStateStatus,statusCheckRollup,commits`), merges with `bin/fm-pr-merge.sh` which records the merge and refuses an unproved one, exits the worker, and runs `bin/fm-teardown.sh`, which refuses on uncommitted changes. Twice today a refusal was a stale staged index whose working tree equalled main; the staged draft was saved to `data/<lane>/staged-leftover.patch`, the index reset, and cleanup completed.

### 7.7 Lessons written into `data/learnings.md`

- Read `gh pr view --json baseRefName` before calling a PR landed (PR 1451 merged into a feature branch).
- A PR body saying "passed" is not a bar; require "0 failed" and the CI checks.
- Parallel data PRs can each pass and leave main red (AGENTS.md pointer test, manifest revision fences); rebase and re-run.
- Vercel refuses CLI deploys whose commit author is not a verified team email.
- The Vercel project is `chengdu`, not `pubmaxx`; the Preview environment points at the production database, so no signed-in preview runs.
- `npm run verify` rewrites 270 pack files to `revision: local`; restore before committing.
- macOS ships 32 SysV shared-memory segments; concurrent embedded Postgres test clusters exhaust them; the harness now serialises initdb.
- Claude Code injects co-author trailers; every brief says never, and the merge bar checks.

---

## 8. Reviews, audits and reports, with verdicts

| Report | Verdict, in one line |
| --- | --- |
| `data/plan-astra/report.md`, `data/reports/PlanAstra.md` (6 Sep, Fable) | Honest and mostly works, not yet something a stranger returns to on a Friday; ten captain decisions D1 to D10; five waves |
| `data/audits/2026-09-06-astra-delta-audit.md` and `data/astra-delta-plan/report.md` | Ten of twelve Astra findings real; all ten shipped by 7 Sep morning (#1583 to #1592); F05 desktop LCP recorded; F11 resolved against Astra |
| `data/mobile-gap-audit/report.md` (4 Sep) | Store paperwork ahead of the app; 20 gaps, all shipped except the owner-only steps |
| `data/core-loop-battle-test`, `data/contribution-battle-test` (5 Sep) | Found the CI-only flag hiding a broken production loop and the storage trigger blocking deletion; both fixed |
| `data/review-merged-code`, `review-thermonuclear`, `review-codebase-design` (5 Sep) | Sound in shape, unsound in four places; every P0 and P1 fixed that night; P2 lists open |
| `data/performance-review/report.md` (6 Sep) | Text routes fast; the map is the whole problem (first pin about 10 s cold); four cache holes; two captain calls (tile CDN, landing primary) |
| `data/starred-repos-triage/report.md` (6 Sep) | Skill layer saturated; tooling gap; 17 installs done, four adoptions the captain said yes to |
| `data/review-code-merged-night2`, `review-codebase-design-night2`, `review-thermonuclear-night2` (7 Sep) | Merges sound; 1 P0 (Spoons key, fixed #1603), P1s fixed (#1600 to #1602), P2 folds open; one captain call (budget resample) |
| `data/verify-main-preview/report.md` (7 Sep) | SAFE TO DEPLOY; 21 PRs; every gate green; migration 0152 applied; preview env uses production Supabase (hazard for signed-in runs) |
| `docs/proof/design-review-fix-web/REPORT.md` (on main) | Every web surface at four widths and both themes fixed above a nit; three decisions, three follow-ups (now shipped as #1605) |
| `data/audits/2026-09-07-skill-scan/README.md` | 357 static flags; human read needed |
| `data/verify-preview` to `verify-preview-5` (4 to 6 Sep) | Each deploy verified on a production-environment preview before the captain's word |

---

## 9. Live walk of production, 7 September

The scout walked https://pubmaxxing.com at `74e688913` between 12:05 and 13:45 BST on 7 September, signed out, read-only, in three cold profiles: phone 390x844 on Slow 4G with 4x CPU throttle, phone unthrottled, desktop 1440x900. Eighteen routes, every tab, every reachable control. 147 screenshots and the raw per-route metrics ride with this file under `docs/proof/astra-live-walk/` (the full report is `report.md` there; scripts to repeat every measurement are in `scripts/`).

### 9.1 Headline

The product is in better shape than the route list suggests. The landing, `/near`, the map itself and the venue sheet are good, fast, and honest about what they know. Three things spoil the first five minutes, and all three are cheap to fix:

1. The map's own arrival card ("FIRST VISIT / Cheapest pints near you?") covers the bottom third of a phone screen over central London; the map's pin probe reports 0 tappable pins while the card is up and 32 to 41 the instant it is dismissed. Reproduced 3 of 3.
2. The homepage's one primary action, "Still £6.50?", opens a price composer whose submit button reads "Sign in to post". The single call to action a stranger meets is a locked door.
3. The Out tab is empty on every day: 148 real listings across tonight, tomorrow and the weekend, none surfaced because no venue matches, while `/tonight` says the city is having a quiet one. Two tabs contradict each other about the same night.

No uncaught page errors on any route in any profile. No 4xx or 5xx except the deliberate 404 and one API bug (B2). TTFB 11 to 100 ms everywhere, median 24 ms. Every CLS inside 0.1.

### 9.2 The stranger's first five minutes

Land on `/`: the best screen on the site. One headline, one photo card (The Blackfriar, £6.50 a pint of Pravha, in the dear band, with publisher, date, and a 2013 archive price), a cheapest-in-borough rail with two £2.99 rows in green. Tap the coral primary "Still £6.50?": the Blackfriar sheet opens with a composer scrolled into view and a submit that says "Sign in to post". That is the stall. Back out, tap Map: pins in price colours, clusters, a lean four-control bar, and the arrival card over the densest pins with a black primary button (every other primary is coral). Tap a pin: a well-built sheet with seven tabs, busyness, hygiene, and "est. £6.50 / Estimated"; the next pin, the same. About a third of the slim pack carries no listed price. Tap Out: "Tonight's 31 listings are all at places we don't list yet" and a link to Ticketmaster. Tap Now: "The city's having a quiet one tonight." Try `/near`: location denied, it answers with central London, 71 priced pubs cheapest first, The Three Tuns at £2.95, "Keep for tonight" on each, no wall, under a second. This is the flow that works and should be what the landing primary does. Try `/plan`: a good composer; the shipped chip "cheap pints tonight in Shoreditch" takes 9.0 s to return a route with no progress signal. Tap a founding member: `/u/karan` is blank ("This passport is blank, for now") with a sign-in email form in the middle of someone else's profile.

Where it flows: landing card, `/near`, the map once the card is gone, the venue sheet, `/plan`'s composer, `/places`. Where it stalls: the homepage primary, the map arrival card, `/out`, `/tonight` versus `/out`, `/plan` generation, founding profiles.

### 9.3 Speed, per route (LCP in ms; requests and bytes from the unthrottled phone)

| Route | LCP Slow 4G | LCP phone | LCP desktop | Requests | KB wire | KB decoded | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 2772 | 456 | 1076 | 57 | 606 | 1675 | 0.004 |
| `/map` | 3316 | 552 | 1016 | 154 | 1354 | 6670 | 0.029 |
| `/pubs` | 1640 | 592 | 1508 | 56 | 1343 | 2526 | 0 |
| `/out` | 3592 | 436 | 2188 | 51 | 548 | 1651 | 0 |
| `/tonight` | 4044 | 1128 | 508 | 68 | 607 | 1854 | 0.085 |
| `/today` | 1392 | 176 | 444 | 54 | 533 | 1584 | 0 |
| `/near` | 1280 | 272 | 604 | 56 | 554 | 1612 | 0 |
| `/social` | 1468 | 276 | 264 | 72 | 641 | 1767 | 0 |
| `/spoons-value` | 1712 | 640 | 1020 | 55 | 564 | 2117 | 0 |
| `/pal` | 1356 | 412 | 548 | 51 | 548 | 1589 | 0 |
| `/onboarding` (bounces to `/`) | 4676 | 476 | 1004 | 62 | 629 | 1707 | 0.004 |
| `/u/you` | 1504 | 512 | 900 | 78 | 648 | 1880 | 0.027 |

First tappable pin on `/map` (the map's own probe, polled from navigation start): desktop unthrottled median 2,537 ms over three runs; phone unthrottled null, null, 2,145 ms (two of three runs never reached a tappable pin inside 17.5 s because of the arrival card); phone Slow 4G 8,891 ms, of which about 3.6 s is the MapLibre chunk parse (pin data arrives at 5.3 s, the engine that draws it exists at 6.8 s).

The three slowest things: `/pubs` ships 792 KB of five unresized photographs through the image proxy into a 344x168 box (load at 8.3 s on Slow 4G); `/plan`'s describe-chip generation takes 9.1 s with no progress state; `/map` decodes 6.7 MB on a phone and makes 154 to 203 requests, 85 of them slim-pack shards on desktop.

### 9.4 Broken, ugly, confusing (worst first)

- B1 (broken, P0): the map arrival card blocks every tappable pin on a first phone visit; its primary button is black, not coral. The project's own pin-ready budget is measured in a state a first-time user is never in.
- B2 (broken, P1): `GET /api/area-news` answers 400 "Unknown area" for 5 of 20 night areas (balham, barnes, bermondsey-london-bridge, piccadilly-soho, victoria). `app/api/area-news/route.ts:30` gates on `isKnownAreaSlug`, which knows neighbourhood slugs (`soho`) while the map passes night-area slugs (`piccadilly-soho`). The map's "New round here" block fails silently over Soho, Victoria, Balham, Barnes and London Bridge.
- B3 (confusing, P1): the homepage primary ends at a sign-in wall; the composer's explainer line is clipped at the top of the sheet; three ways to enter one number are stacked.
- B4 (broken, P1): `/out` is empty on every day (31, 54, 63 listings, all unmatched), its only primary is "Open the map", and it contradicts `/tonight`.
- B5 (broken, P2): `/spoons-value`'s "See it on the map" goes to bare `/map` with no units lens (`app/spoons-value/page.tsx:112`; `lib/spoonsValue.ts:666` returns `/map?sel=<id>` with no lens for all 805 rows), and its 805 row links prefetch the map (`SpoonsValueTable.tsx:86` has no `prefetch={false}`; the prefetch fence test misses it because it allow-lists helper names rather than matching call sites ending `mapHref`).
- B6 (confusing, P2): `/onboarding` server-renders a document titled "Set up your first night" then bounces to `/`, recording the worst LCP on the site (4,676 ms on Slow 4G); the web first-run surface is unreachable.
- B7 (ugly, P3): the 404 page preloads 17 stylesheets it never uses and carries the homepage title.
- B8 (ugly, P2): `/pubs` ships 792 KB of unresized photographs; its first chain row is "No price logged yet" and its drink chips read "Shots" and "Whisky".
- B9 (ugly, P2): the desktop map shows 17 chrome elements before a pin is touched; the Filters control works and badges correctly, but its popover has no visible container and clips the Elizabeth line banner; the Clubs chip is permanently disabled with a `title` no phone shows.
- B10 (confusing, P3): founding member profiles are blank and carry an inline sign-in form.
- B11 (small): `/drinks` redirects to an empty Discover panel; the consent card sits 8 px above the tab bar rather than flush and its copy is cramped beside two unequal buttons; MapLibre logs US road-shield style warnings on every load; the plan stop-count chips and the price chips are two different number-chip shapes.

Verified correct: the consent card fires only after the product answers first (absent on `/` and `/tonight` on first visit, present on the second route, full-bleed, opaque); the five price chips wrap exactly 4+1 at 390; the venue sheet opens at a fixed 464 px box; the tab bar hides under an open sheet by design; all six tabs navigate in about a second; `/near` degrades perfectly when location is denied.

### 9.5 What a new plan should fix first (the scout's order)

1. Take the map arrival card off the pins: a top strip, a chip, or dismiss on the first map gesture.
2. Point the homepage primary at an answer, not a login: send "Still £6.50?" to the unauthenticated result `/near` already gives and ask for the account after the answer.
3. Accept night-area slugs in `isKnownAreaSlug`, or answer `unavailable` with a 200 for an unmapped area.
4. Give `/out` something or fold it into `/tonight`.
5. Carry the units lens on `/spoons-value`'s CTA and its 805 row links.
6. `prefetch={false}` at `SpoonsValueTable.tsx:86`, and make the prefetch fence match call sites ending `mapHref` or `mapUrl`.
7. Resize image-proxy output to the requested box with a `srcset` (792 KB to about 60 KB on `/pubs`).
8. A progress state on `/plan`'s describe chips, and profile the 9 s generation.
9. Cut the desktop map's 17 arrival controls; enable the Clubs chip or drop it.
10. Decide what `/onboarding` is on the web: a real surface, or an edge redirect that ships no document.

Two of these are product calls and are held for the captain (section 10.1): what `/out` is, and what the landing primary does (captain decision of 4 September, issue #1357, made it the Pint Drop door).

---

## 10. What needs to be built next

### 10.1 Blocking on the captain (decisions and accounts)

1. Deploy word for each future release (one a day, after a preview verification).
2. Performance gate stability lane (`perf-gate-stability`, brief ready): symmetric resample, more samples and a warm-up on the four noisy routes, noise measured before and after, no ceiling moved. Two false reds today; every PR is a coin flip on those routes until this lands.
3. The one-off re-run of #1611's performance job, then merge the AGENTS.md split.
4. PlanAstra decisions D1, D2, D4 to D10 (D3 answered: London pictures). Recommended: D1 (b) one question first screen; D2 (a) five social primitives; D4 (a) the sixty-second flow; D5 (a) Friday 17:00 push; D6 (a) firewall challenge on documents only; D7 (a) closed snapshots off the map; D8 (a) fold Rounds into Plans; D9 one city picker; D10 hold the Pint Index.
5. Performance review calls: map tiles on our own CDN (`perf-review-tile-cdn`); landing primary keeps "Still £6.50?" or becomes "Cheapest pint near me" (`perf-review-landing-primary`).
6. Store accounts: Apple Developer enrolment (Team ID into the association file, APNs key), Google Play (SHA-256 fingerprint into assetlinks, closed test with 12 testers for 14 days), the `support@pubmaxxing.com` mailbox (docs and store copy already point at it).
7. Supabase dashboard: enable leaked-password protection (password paths named in the #1586 PR body). Vercel: delete `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2` from both environments; point the Preview environment at an isolated Supabase project; set the firewall challenge to documents only.
8. Reddit r/london megathread ingestion ("add all of these to London and make it more dense"): Reddit returns 403 to this Mac on every route; the captain pastes the thread text or creates a Reddit API app.
9. Dependabot: two green dependency groups (#1607, #1608) await "merge deps"; the two vitest 5 majors (#1609, #1610) are red and need a lane or a close.
10. From the live walk: what `/out` is (`astra-live-walk-out-tab`: invest in venue matching, fold it into `/tonight`, or print unmatched listings as rows with a source credit); what the landing primary does (`astra-live-walk-landing-primary`: keep the Pint Drop door and its sign-in wall, send it to the `/near`-style answer and ask for the account after, or let a signed-out drinker post).
11. Older held calls: `review-merged-code-captain-calls`, `review-thermonuclear-captain-calls`, `review-codebase-design-captain-calls` (#727 retarget, `lib/` fold), `vendored-skills-in-repo`, `budget-resample-one-sided`.

### 10.2 Wave 0, this week: the live walk's ten fixes

Section 9.5 in the scout's order. B1, B2, B5, B6 and B8 are root-caused to a line and are each a small testable PR (section 8 of the walk report names the existing test pin for each). B3 and B4 wait on the two captain calls above.

### 10.3 Wave 1: the first sixty seconds and the photograph

- D1 first screen: one question ("Where are you drinking?") with an area picker and Near me, then the cheapest three pints there, then the map with the answer selected (PlanAstra section 3 is the screen-by-screen script).
- D4 onboarding: the sixty-second flow on the web and in the shell.
- Photographs: a photograph for every priced pub (405 of 1,617 today), chain assets through the proxy with credit, then community photographs.
- The map's 12 to 18 MB: closed price snapshots off the map and behind `/api/venue/[id]` (D7); MapLibre chunk split; the first tappable pin under 2.5 s on the throttled rig (today about 10 s).
- Desktop LCP: `/pal` 5.9 s p75 in the field; the desktop row now recorded, the fix is next.
- The reduced map toolbar at 768 and 1440 (Filters shipped; banners stack one at a time; the first-visit card replaces the Pal chip while open).

### 10.4 Wave 2: a second person

The public London-tonight lane on Social signed out (recent public Pint Drops with photos, open crews, historic picks; sign-in only on the first write), camera-first Pint Drop, "I'm here" on the sheet, the second-drinker door on the pin, the contributor record with faces. Proves: a stranger sees someone else's photo and price before signing in; a drop takes three taps.

### 10.5 Wave 3: plan together

Plan chat, open crews on the map, the plan as a card, Rounds folded (D8), the recap share-first, the WhatsApp share text with an absolute host. Proves: two accounts plan and talk in one place; a stranger can ask to join a night.

### 10.6 Wave 4: the second Friday

The Friday 17:00 digest (push, email fallback), the weekly "still £X?" ask, activity that is activity, passport stamps, hours on the sheet. Proves: a reader who logged one pint hears from the product once a week and comes back.

### 10.7 Wave 5: the stores and the city

iOS and Android submission through the owner-only steps in `docs/STORE_READINESS.md` section 8; the share target; the historic index as walks; drink pages for every brand the landing can name; the P2 debt from the six reviews.

### 10.8 Engineering debt worth a lane each

- The P2 lists: `lib/` is 871 flat modules (fold by domain); ten test files are half the suite's cost; 209 exported lib symbols exist only for tests; four runtime import cycles in the auth provider; the design law lives in four places (one door now, the rest to fold); one-area geometry and location-ask fences; the dataset should have one reader.
- `INSTALLED_SKILLS.md` (300 KB) and the vendored `skills/` tree in the product repo (held call `vendored-skills-in-repo`).
- 279 venue-pack files on main carry `revision: local` (harmless in production, restore on a future commit).
- Pint Index: empty since 16 July; hold or seed (D10).
- `/drink/pravha` 404; two city pickers; test handles on the founders wall; `/rounds` stub; `/we-are-out` dark.

### 10.9 Measurement

North star: weekly groups that complete a planned outing and repeat (`docs/analytics/METRICS.md`). Release metric: Weekly Meaningful Nights (`docs/analytics/TRACKING_PLAN.md`). Every event now carries environment, release and schema version, so a preview's numbers and production's no longer share a bucket. PostHog is connected (key in Vercel env). The Slow 4G table and the desktop row in PlanAstra section 6 are the speed scoreboard.

---

## 11. Principles to hold (MECE, from the plan and the reviews)

1. One rule, one owner, one module: price band, trust, adult gate, site contact, brand naming, button tokens each live in one file that everything reads.
2. The product answers first; it asks only at the first action worth keeping.
3. A price wears its band and no other colour; trust is a label.
4. Every absence is worded by the lane that knows why (unavailable, not mapped, no price yet, snapshot).
5. Every surface has a budget; a ceiling only goes down; a breach is fixed at source or proven noise.
6. Every claim in a PR body is a command someone can re-run; every UI change ships proof shots at 390, 768 and 1440.
7. Never a synthetic write against production; verification runs on a production-environment preview.
8. No AI-template patterns; kickers stay; the unslop checklist on every piece of copy.
9. A migration carries its rollback and its PostgreSQL proof by name; it runs only on the captain's word.
10. Nothing lands red, and nothing red is laundered.

---

## 12. Traps for the next agent

- The captain's own clone at `~/Documents/projects/pubmaxx` is on main with three uncommitted files and about 195 commits behind. Never reset or delete it; worktrees hang off its `.git`.
- The Claude session window empties every five hours under a full fleet; workers stall silently at "You've hit your session limit"; nudge them after the reset.
- `fm-send --fire-and-forget` is never re-rung; an idle worker needs the doorbell prompt sent again (`herdr agent prompt <pane> "Firstmate instruction waiting: ..."`).
- A worker's background CI polls wake the orchestrator on every completion; forbid them in the brief.
- The performance gate's four noisy routes will go red on noise until the stability lane lands; a red on a route the PR does not touch is the tell.
- `bin/fm-control.sh <id> exit` needs an Enter in the pane to confirm the exit dialog; teardown then force-kills leaked worktree processes.
- The Fact-Forcing gate blocks the first Bash of a session and every new file write; state the facts and retry.
- SkillSpector refuses symlinked inputs; scan the resolved path.
- Reddit blocks this Mac; there is no Google Chrome, so chrome-devtools-axi needs a Chrome-for-Testing binary on a CDP port, or use the repo's Playwright.

---

## 13. Repository map (what a new plan reads first)

- `AGENTS.md` (splitting into a per-area tree in #1611), `CLAUDE.md` -> `AGENTS.md`, `CONTEXT.md` (glossary), `PRODUCT.md`, `DESIGN.md`, `README.md`.
- `docs/PERFORMANCE_BUDGETS.md`, `perf/route-budgets.json`, `perf/cwv-baseline.json`, `e2e/performance-budget.spec.ts`, `e2e/helpers/perfMeasurement.ts`, `scripts/check-budget-ratchet.mjs`.
- `docs/DEPLOYMENT.md`, `scripts/deploy-vercel.mjs`, `scripts/deploy-preview-prod-env.mjs`, `vercel.json`.
- `docs/STORE_READINESS.md`, `docs/CAPACITOR_WRAP.md`, `docs/IOS_APP_PRD.md`, `capacitor.config.ts`, `ios/`, `android/`, `lib/storeListing.ts`, `lib/native*.ts`.
- `docs/analytics/METRICS.md`, `docs/analytics/TRACKING_PLAN.md`, `lib/analytics/`.
- `lib/priceBand.ts`, `lib/pintTrust.ts`, `lib/venueTruth.ts`, `lib/adultGate.ts`, `lib/siteContact.ts`, `lib/brandNaming.ts`, `lib/storeBackend.ts`.
- `components/map/`, `components/analytics/`, `components/plan/`, `components/messages/`, `app/globals.css`, `app/theme.css`.
- `supabase/migrations/` (0001 to 0152, each with a rollback twin and a proof), `__tests__/` (unit, RLS, fences), `e2e/` (216 specs), `docs/proof/` (screenshot evidence per lane).
- `data-harvest/` and `seeds/` (the price crawl, PDF and OCR lanes, night areas), `public/data/` (build-written packs), `public/landing/london/` (photographs with `ATTRIBUTION.md`).

---

## 14. Index of sources

Fleet home `~/karan-agent-workspace`: `data/captain.md` (laws), `data/learnings.md` (operational facts), `data/checkpoints/2026-09-0{3,4,5,6}-pubmax.md` (the minute-by-minute record), `data/backlog.md`, `data/<lane>/brief.md` and `data/<lane>/report.md`, `data/audits/`, `data/reports/PlanAstra.md`, `data/verify-main-preview/report.md`, `data/astra-live-walk/report.md` (also in the repository under `docs/proof/astra-live-walk/`).

GitHub: https://github.com/Singularityszn/pubmax pull requests #1331 to #1611; Wayfinder maps #1354, #1423, #1576; grilling ticket #1580; residual epic #1522; review-bloat epic #727.

Vercel: team `pubmax69`, project `chengdu`, https://pubmaxxing.com, `/api/version`. Supabase: project `iankajxliutqogqkmvdg` (production), `qdojzkgrpujqetgcimfy` (pentest).
