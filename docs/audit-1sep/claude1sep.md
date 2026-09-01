# PubMaxxing — Fable fix brief (1 Sep 2026)

Copy-paste brief for implementation. **Evidence-only.** Do not invent metrics, users, or deploys.

**Repo:** `Singularityszn/pubmax` (Vercel project `chengdu` / team `pubmax69`)  
**Live prod (measured Tue 1 Sep 2026 ~06:30–07:40 BST):**  
- deploy `dpl_GgcaSuzEx5rwrtnCAuFzX3p1wQLq`  
- sha `be32535456bbcbc804c1fb0071fc1fd539752166`  
- commit `#1295` `fix(supabase): reconcile production migration ledger`  
- ready **Tue 1 Sep 2026 06:03:52 BST**  
- `GET /api/version` + HTML `data-dpl-id` match  
- **main HEAD == live**  
- `GET /api/pint-drops` still `{"drops":[]}`

Screenshots in this folder:
- `desktop/` — 1440×900 logged-out desktop
- `mobile/` — 390×844 logged-out phone

---

## Locked three-bar (do not widen the cut)

1. **Map** draws real tiles + priced pins.
2. **A pint you can log** — signed-in write path such that public `GET /api/pint-drops` is **not** `[]`. Sign-in-to-post is fine if a signed-in post actually writes.
3. **Tonight is pubs** — or an honest empty that does **not** advertise quiz/sport/deals while serving none.

**Current live state (1 Sep):**
| Bar | Verdict | Evidence |
|---|---|---|
| Map | PASS with flake | Tiles + priced pins on desktop + fresh mobile. Persistent sessions often show **“The pub list hasn’t loaded. Tap Retry to fetch it again.”** while tiles still paint. `desktop/02-map.png`, `desktop/09-map-list-error.png`, `mobile/map.png` |
| Pint | **FAIL** | Cold visitor terminal: **“Sign in to add a price”**. API still `{"drops":[]}`. `desktop/03-map-log-wall.png`, `mobile/cold-log-signin2.png` |
| Tonight | Honest deals+music, **not** pubs-tonight | Lede: **“Deals and live music from sourced listings…”** with Goldengrove (Tue Gourmet Burgers Club) + The Lexington (Oliver Hazard). `#1264` is live. `whats-on` = **137** rows (96 Tue JDW + 41 Ticketmaster). `desktop/05-tonight.png`, `mobile/tonight.png` |

---

## P0 — ship blockers for v0 / Product Hunt

### P0-1 — Public Pint Drops empty
- **Bug:** `GET /api/pint-drops` → `{"drops":[]}`. Cold log wall: “Sign in to add a price” / “You need an account to add a price. Sign in here and we’ll bring you back to The Dolphin Tavern.”
- **Acceptance:** After one authorised signed-in real pint on prod (or preview then prod), unauthenticated `GET /api/pint-drops` returns at least one drop. Do **not** seed fake drops.
- **Shots:** `desktop/03-map-log-wall.png`, `mobile/cold-log-signin2.png`, `mobile/map-log.png`
- **Do not:** reopen closed-unmerged `#1237` / `#1211` as a mega-PR. Tiny PRs only if needed (`writeOneTapPricePair` etc.).

### P0-2 — Map pub list load flake
- **Bug:** Persistent desktop + mobile sessions show **“The pub list hasn’t loaded. Tap Retry to fetch it again.”** Fresh mobile map can still show priced pins.
- **Acceptance:** Cold + warm `/map` loads priced list without the retry banner; Retry recovers if network fails once.
- **Shots:** `desktop/09-map-list-error.png`, `desktop/02-map.png`

---

## P1 — high priority UX / honesty

### P1-1 — Pub / venue images misaligned (Karan + visual audit)
- **Bug:** Pub and venue images are **not aligned properly** across surfaces (map venue sheets, Out/Tonight cards, historic/crawl cards, home hero drink overlays). Home hero drink chips float over the bar photo without a consistent grid; Out cards often show text-only venue blocks where imagery should sit flush.
- **Acceptance:** Consistent image aspect ratio, object-fit, and card padding; no clipped/skewed/mis-cropped venue photos; home hero overlays on a defined grid; empty image state uses a single placeholder pattern.
- **Shots:** `desktop/01-home.png` (hero overlays), `desktop/06-out-tonight.png` (card layout), `mobile/out.png`, `mobile/tonight.png`, `desktop/05-tonight.png`, `mobile/map.png` / venue sheets if present

### P1-2 — Mobile header nav still dead after `#1263`
- **Bug:** Header links Map / Plan / Tonight / Moment / Social / You measure **0×0**, parent `display:none`. Bottom nav only. `#1263` (`fix(map): keep mobile chrome inside viewport`) is merged + on prod — verify what it fixed vs leftover.
- **Acceptance:** Either show tappable header items (≥44px) or remove dead anchors; bottom nav remains authoritative.
- **Shots:** `mobile/home.png`

### P1-3 — Tonight inventory ≠ pubs-tonight (PH USP)
- **Bug:** Page is honest for deals+live music, but v0/PH story needs **pubs tonight** (or quiet empty without advertising deals while only serving Spoons/TM theatre).
- **Acceptance:** Tonight surface prioritises pub plans / priced pubs / honest quiet; do **not** “fix” by hiding Ticketmaster globally.
- **Shots:** `desktop/05-tonight.png`, `mobile/tonight.png`

### P1-4 — Mobile first-visit card covers map
- **Bug:** “Cheapest pints near you?” covers ~**244px** of lower map (was ~311px). Pins under the card untappable until dismiss.
- **Acceptance:** Card does not block pin hit-targets; or auto-dismiss / relocate above pins.
- **Shots:** `mobile/map.png`

### P1-5 — `/plan` First pint defaults in the past
- **Bug:** After Make a plan, First pint defaulted to `2026-08-31T23:00` while audit was ~06:35 BST 1 Sep — already past.
- **Acceptance:** Default First pint ≥ now (London); never silently past.
- **Shots:** `desktop/07-plan.png`, `mobile/plan.png`

---

## P2 — polish / hygiene

| ID | Issue | Evidence |
|---|---|---|
| P2-1 | `pint_prices` asOf **3 July 2026**, age ~1433h, status still `fresh` (budget 2160h). Copy on `/today` (+ mobile `/pint-index`): “as of 3 July 2026” | `desktop/04-today.png`, `mobile/pint-index.png`, tech audit |
| P2-2 | Brand split **PUBMAXX** (logo) vs **PUBMAXXING** (analytics/login/About) | `desktop/01-home.png`, `mobile/login.png`, `mobile/about.png` |
| P2-3 | Clerk leftover CSP `rare-trout-29.clerk.accounts.dev` on `/` | tech audit |
| P2-4 | Founders stuck **“6 of 100 taken.”** | `desktop/08-founders.png`, `mobile/founders.png` |
| P2-5 | Home / About still **“eight quid”** hero | `desktop/01-home.png`, `mobile/home.png`, `mobile/about.png` |
| P2-6 | `/api/wanted` → 401 on cold `/u/you` (expected auth; quieter skip preferred) | desktop click-log |
| P2-7 | `/out` unmatched TM heavy (58 events / 57 unmatched) — honesty OK; matching quality weak | `desktop/06-out-tonight.png`, API |

---

## Fixed since 30 Aug night (do not re-file)

- Tonight Share → **“Link copied”** (was “Could not share tonight”) — `mobile/tonight.png`
- Weather blank pink `weatherRecSubmit` pill — fixed; weather populated
- `/plan` typed text survives chip tap
- Pal avatar renders (`mobile/pal.png`); PNG GET 200
- `#1264` Tonight honesty lede/window on prod
- main == live (night’s “features on main not deployed” gap closed)

---

## Screenshot index

### Desktop (`desktop/`)
![Home eight quid + hero](desktop/01-home.png)
![Map tiles + pins](desktop/02-map.png)
![Sign in to add a price](desktop/03-map-log-wall.png)
![Today 3 July stamp](desktop/04-today.png)
![Tonight deals + live music](desktop/05-tonight.png)
![Out Tonight Ticketmaster / PUBMAXX VENUE](desktop/06-out-tonight.png)
![Plan](desktop/07-plan.png)
![Founders 6 of 100](desktop/08-founders.png)
![Pub list hasn’t loaded](desktop/09-map-list-error.png)

### Mobile (`mobile/`)
![Home](mobile/home.png)
![Map + first-visit card](mobile/map.png)
![Map log picker](mobile/map-log.png)
![Cold pint wall](mobile/cold-log-signin2.png)
![Tonight + Link copied](mobile/tonight.png)
![Out](mobile/out.png)
![Plan](mobile/plan.png)
![Today](mobile/today.png)
![Pint index](mobile/pint-index.png)
![Founders](mobile/founders.png)
![Pal](mobile/pal.png)
![Login PUBMAXXING](mobile/login.png)
![About](mobile/about.png)
![Social](mobile/social.png)
![Social discover](mobile/social-discover.png)
![Near](mobile/near.png)
![Moment](mobile/moment.png)
![Choose city](mobile/choose-city.png)

---

## Explicit DO NOT

- Do **not** merge to `main` / promote prod without Karan’s explicit word
- Do **not** change production env vars / billing
- Do **not** hide Ticketmaster as the cut
- Do **not** reopen `#1237` / `#1211` mega-pile
- Do **not** fake / seed Pint Drops
- Do **not** invent metrics or users
- Do **not** promote more Social / Moment / Pal-as-front-door until a **live drop + second independent voice**
- Do **not** spend the cut on Dependabot `#1290`/`#1291`, new city, or second auth

---

## Acceptance order (recommended)

1. P0-1 real signed-in pint → public `pint-drops` non-empty  
2. P0-2 map list-load reliability  
3. P1-1 pub image alignment  
4. P1-2 mobile header dead links  
5. P1-3 Tonight pubs (or honest quiet) without widening into TM-hide  
6. P1-4 / P1-5  
7. P2 slop as drive-bys only  

## Path toward #1 social (after P0)

live drop → second independent drinker → pin colour → then Crew Night / Social with real inventory. **Social on empty `drops` is costume.**

---

## Source audits (box paths; optional)

- `/workspace/audit-1sep-mece.md`
- `/workspace/audit-1sep-tech.md`
- `/workspace/audit-1sep-github.md`
- `/workspace/audit-1sep-desktop/click-log.md`
- `/workspace/audit-1sep-mobile/click-log.md`
