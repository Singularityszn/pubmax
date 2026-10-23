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

Before and after-copy captures are under `artifacts/writing-refresh/`, with
seven page families at 390, 768 and 1440 pixels. These first captures use a
keyless development server on port 3197. Dark screenshots taken during a theme
transition are diagnostic only. Final production-build checks are recorded
separately below. Production data and authenticated services are not simulated
as live evidence.

The archive disclosure test failed before implementation. Focused rendered
copy tests, lint and TypeScript checks are recorded in the task logs. Final
verification is pending until both stages are complete.

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
