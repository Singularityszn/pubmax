# Writing and visual refresh

Base: `1dd819f3c`, current `origin/main` when this work started. The owner chose
an independent refresh, separate from open PRs #2347, #2339 and #2346. Those PRs
must be reconciled before merge, especially homepage copy, Tonight credits,
area availability and About schema. This change does not deploy production.

## Stage 1

The homepage introduces its task in one sentence. Measured savings and their
dates appear together below the main answer. Historical prices retain their
source and comparison limits inside an Earlier prices disclosure. About keeps
its source policy, confirmation rules, founder quote and press kit, with optional
background folded away. Pub Pal names its purpose and setup choices directly.
Area coverage describes available actions while keeping the eligibility checks.
Source dates use Records from in the existing shared formatter.

The local better-writing skill now starts with docs/VOICE.md, checks a whole
page for repetition and requires a rendered review. Legal meaning, permission
copy, quoted sources and user posts remain protected.

## Coverage inventory

| Family | Copy and states | Treatment |
| --- | --- | --- |
| Home | Intro, prices, history, missing prices, savings, footer, FAQ | Edited and covered by rendered unit tests |
| Today and Tonight | Recommendations, empty listings, source dates, unavailable sources | Copy edited, provider decisions retained |
| Social and discovery | Tab headings, area availability, public lists, signed-out boundary | Headings and coverage copy edited |
| Pub Pal | Meeting, age check, appearance, voice, permissions, memory | Meeting and setup labels edited, existing interaction tests retained |
| Map and nearby | Search, filters, venue sheets, price records, location refusal | Existing routes and controls retained, shared date caption simplified |
| Plan and shared plans | Intake, result, unavailable plan, sharing | Existing concise controls retained |
| Borough, area, drink and historic pages | Place images, prices, source links, empty records | Media reviewed in stage 2 |
| About | Description, source policy, founder, figures, press, attribution | Repetition removed, disclosures added |
| Account, sign-in and onboarding | Authentication, consent, account deletion | Existing copy and behaviour retained |
| Messages, moments and profiles | Private content, public posts, empty and error states | User content retained |
| Price index and reference pages | Dates, methodology, source data | Shared date caption simplified |
| Legal and credits | Privacy, terms, attribution | Retained |
| Feedback and contributions | Forms, validation, confirmation | Retained |
| Administrative and integration pages | Moderation and API information | Outside the public visual refresh |

This inventory records every page template. It does not claim that every
signed-in state or every dynamic URL received a browser check.

## Evidence

Matched baseline and final captures are under `artifacts/writing-refresh/`, with
seven page families at 390, 768 and 1440 pixels in both themes. The baseline and
final builds use the same Playwright environment on private ports 3199 and 3198.
Earlier development captures remain diagnostic only. Both builds use test
provider configuration, not a real signed-in account.

| Page | Before | After |
| --- | --- | --- |
| Homepage | ![Homepage before](before-home-phone.png) | ![Homepage after](after-home-phone.png) |
| About | ![About before](before-about-phone.png) | ![About after](after-about-phone.png) |
| Pub Pal | ![Pub Pal before](before-pal-phone.png) | ![Pub Pal after](after-pal-phone.png) |

![Four founder photographs linked to the map](journal-desktop.png)

![Optional London film with a static poster and playback button](film-desktop.png)

The final production build passed. Nine additional accessibility, keyboard and
reduced-motion checks passed. The focused Chromium run passed all 32
checks across the new journal/film suite and the existing homepage, photography
and Pub Pal layout suites. It covers 390, 768 and 1440 pixels in light and dark,
reduced motion, keyboard playback and disclosures, stable media dimensions,
no video request before Play, and media failure recovery. A separate 200% text
check found no horizontal overflow on the seven reviewed page families.

## Stage 2

Around London uses four existing founder photographs. Southwark, Leadenhall
Market and Canary Wharf link to map searches. The Crown Tavern links to the
Clerkenwell venue, not the pub with the same name in Lewisham. Existing photo
rules also use the relevant images on Southwark, Canary Wharf and Crown Tavern
pages. Wider-area images retain their area labels.

The optional film uses these same four privacy-edited photographs. It has 288
frames at 24 fps, runs for 12 seconds and contains no audio. The H.264 file is
1,675,670 bytes at 720 by 960 pixels. Existing AVIF and WebP images supply the
poster. No video element or media request exists before Play. Playback has
native controls, place captions, keyboard focus and an error retry. Reduced
motion keeps the poster static until the reader requests playback.

## Repository verification

`PUBMAX_VERIFY_COMMITTED_DATA=1 NEXT_PUBLIC_SW_VERSION=local npm run verify`
passed on 23 October 2026. The coverage run passed 43,521 tests in 2,104 files,
with one existing skipped test/file. PostgreSQL permission and migration tests
passed 681 tests in 74 files. The separate harness checks also passed.
Lint, database types, TypeScript, dead-code checks, data validation, install
policy and the dependency audit passed. Freshness reported two stale datasets
and three unmeasurable store feeds as advisory findings. They are not claimed
fresh. The full log is `/tmp/pubmaxx-writing-verify-complete.log`.

## Performance

The first ad hoc measurements used the fallback harness timing boundary and
reported JavaScript budget breaches on Home, Pub Pal and About. The repository's alternating A/B check then measured the
branch and its exact base on the same machine. Each arm supplied three samples.

| Route | Base decoded JS | Refresh decoded JS | Existing ceiling |
| --- | ---: | ---: | ---: |
| Home | 856 KB | 858 KB | 1,010 KB |
| Pub Pal | 915 KB | 915 KB | 1,050 KB |
| About | 771 KB | 771 KB | 960 KB |

The A/B classified all three as no slower than base and reported timing drift
in the earlier measurement. This comparison does not waive a budget gate or
prove performance on routes it did not measure. No ceiling was raised. The scoped check through the repository Playwright runner then passed every
metric for all three routes with the page-ready boundary. It recorded no
breaches and no unmeasured metrics. The [final samples](performance.json) are
attached. The original fallback result remains in the local artifacts directory.
The [A/B report](performance-ab.txt) records the method and verdict.

## Review

### Standards

The independent standards review found that the journal link label hid its
price caption from the accessible name. The link now uses its visible caption,
including the listed price and half-mile qualification, as its accessible name.

### Specification

The independent specification review found that a ready-area link promised an
area-specific planner, but opened the general planner. Its label now says
Open planner. The destination and eligibility rules are unchanged.

## Delivery checklist

- [x] Keep the original routes and navigation destinations.
- [x] Preserve price qualifications, credits, consent and recovery text.
- [x] Keep the Thames hero and existing design tokens.
- [x] Inventory public route templates and record unchanged families.
- [x] Keep the local writing skill specific to PUBMAXX.
- [x] Separate copy/layout and photography/film in distinct commits.
- [x] Include requested playback, reserved media dimensions and failure recovery.
- [x] Complete the performance comparison and scoped budget checks.
- [x] Complete final repository verification.
- [ ] Complete the required publishing gate and hosted review.

Real account sessions, physical devices and assistive-technology software were
not exercised. The browser checks cover the provider-shaped test environment.
These limits remain separate from unit coverage and production release approval.

## Route templates

- `/`
- `/about`
- `/account/delete`
- `/activity`
- `/add-a-pub`
- `/add/[handle]`
- `/admin`
- `/area/[slug]/drink/[brand]`
- `/bar-tab/[id]`
- `/borough`
- `/borough/[slug]`
- `/contributors`
- `/crawls`
- `/crawls/[slug]`
- `/credits`
- `/discover`
- `/drink/[slug]`
- `/drinks`
- `/feed`
- `/feedback`
- `/founders`
- `/historic`
- `/historic/[slug]`
- `/how-we-estimate`
- `/invite/[token]`
- `/landmark/[id]`
- `/ledger/[id]`
- `/login`
- `/map`
- `/map/[city]`
- `/map/arrival`
- `/messages`
- `/messages/[id]`
- `/moment`
- `/near`
- `/onboarding`
- `/p/[id]`
- `/pal`
- `/pal/chat`
- `/pint-index`
- `/pint-index/[month]`
- `/places`
- `/plan`
- `/plan/[id]`
- `/plan/[id]/recap`
- `/price-pulse`
- `/privacy`
- `/profile`
- `/pubs`
- `/pubs/[id]`
- `/recap/[storyId]`
- `/rounds`
- `/rounds/[code]`
- `/signin`
- `/social`
- `/social/crews/[crewId]`
- `/soft-drinks-and-water`
- `/spoons-value`
- `/terms`
- `/today`
- `/tonight`
- `/u/[handle]`
- `/u/[handle]/lists/[listType]`
- `/u/[handle]/people/[relation]`
- `/updates`
- `/wall`
- `/we-are-out`
- `/webmcp`
