# UI consistency evidence

This evidence compares two production builds through Playwright at 390, 768,
1280, and 1440 CSS pixels.

- [Before](before/) was built from `3bc4dd42`.
- [After](after/) was built from `91faf022` plus review worktree diff
  `f2bc9afb`.
- Each final phase used one completed `next build`, one `next start` process,
  and one successful sequential Playwright run for all widths and routes.
- [Before measurements](before/measurements.json) and
  [after measurements](after/measurements.json) name server mode and build
  commit, and hold rendered boxes plus assertions.
- Ordinary Playwright runs execute the same layout assertions without rewriting
  evidence; explicit before or after phases add the captures and measurements.

The earlier dev capture at `3bc4dd42` is retained in Git history but is not used
for the comparison below. It left three route rows incomplete and therefore
missed the 1440 public profile defect. Production completed 92 of 92 route
measurements and found all six affected profile rows. Matched visible controls
kept their measured heights; the production recapture also used the expanded
selector that includes Drink, My pint, and Drinks.

## Desktop route audit

The audit covers 46 page routes at both desktop widths. Before the fix, the
shared profile shell had a 1240px max width but computed zero inline margins.
The same shell owns the redirecting account route, public profile, and profile
list.

| Width | Route | Before left/right | After left/right | After max width |
| --- | --- | ---: | ---: | ---: |
| 1280 | `/profile` | 0/40px | 20/20px | 1240px |
| 1280 | `/u/layoutcaptain` | 0/40px | 20/20px | 1240px |
| 1280 | `/u/layoutcaptain/lists/favourites` | 0/40px | 20/20px | 1240px |
| 1440 | `/profile` | 0/200px | 100/100px | 1240px |
| 1440 | `/u/layoutcaptain` | 0/200px | 100/100px | 1240px |
| 1440 | `/u/layoutcaptain/lists/favourites` | 0/200px | 100/100px | 1240px |

No other audited route had unbalanced main-content gutters. After assertions
reject unbalanced gutters, missing 200-response main content, and loading shells.
The production after run recorded 47 passing layout assertions and zero failures.

## Shared-row control heights

Vectors follow visible left-to-right order. `×N` means N rendered controls at
that height.

| Surface and row | 390 before / after | 768 before / after | 1280 before / after | 1440 before / after |
| --- | --- | --- | --- | --- |
| Landing hero: Find my pint, Open the map, Plan my night | 54×3 / 54×3 | 54×3 / 54×3 | 54×3 / 54×3 | 54×3 / 54×3 |
| Map and venue topbar | 44×5 / 44×5 | hidden / hidden | hidden / hidden | hidden / hidden |
| Map and venue contextual row: Near me, Tonight, Filters | 44×3 / 44×3 | hidden / hidden | hidden / hidden | hidden / hidden |
| Tonight Arc: Pints, Bars, Clubs, Food, Restaurants | 44×5 / 44×5 | 34×5 / 34×5 | 34×5 / 34×5 | 34×5 / 34×5 |
| Desktop map and venue toolbar: Search, Drink, My pint, Drinks, Zone, Plan, City | hidden / hidden | 34×4 / 44×4 | 34, 32, 32, 34, 44, 34, 34 / 44×7 | 34, 32, 32, 34, 44, 34, 34 / 44×7 |
| Plan area choices | 48×8 / 48×8 | 48×8 / 48×8 | 48×8 / 48×8 | 48×8 / 48×8 |
| Plan footer: Back, Skip for now, Continue | 44×3 / 44×3 | 44×3 / 44×3 | 44×3 / 44×3 | 44×3 / 44×3 |
| Profile header: Invite your lot, Edit profile, Meet your Pub Pal | 44×3 / 44×3 | 44×3 / 44×3 | 44×3 / 44×3 | 44×3 / 44×3 |
| Profile Options | absent / hidden | absent / 44 | absent / 44 | absent / 44 |

At 768, only Search, Drinks, Plan, and City render in the desktop toolbar. At
1280 and 1440, all seven listed controls render. Conditions did not render in
the captured state, so no pixel claim is made for it. After assertions require
zero height spread in each row with at least two rendered controls.

## Floating surface edges

The phone navigation bar remains its own full safe-width surface at 10-380px.
The action stack beneath it now uses one left-aligned safe lane.

| Width | Before | After |
| --- | --- | --- |
| 390 | contextual 10-380px; Arc 12-322px; Describe 72-318px | contextual, Arc, Describe 12-322px |
| 768 | nav 12-756px; Arc 222.35-545.65px; toolbar 16-752px | nav, Arc, toolbar 16-752px |
| 1280 | nav 180.33-1099.67px; Arc 478.35-801.65px; toolbar 110.25-1169.75px | nav, Arc, toolbar 20-1260px |
| 1440 | nav 260.33-1179.67px; Arc 558.35-881.65px; toolbar 190.25-1249.75px | nav, Arc, toolbar 100-1340px |

Venue-sheet captures use the same horizontal map-chrome boundaries. Its
inspector remains a full-width bottom sheet on phone and a right-aligned sheet
on desktop.

Alignment systems now are:

- Map: left-aligned 12-322px phone action stack; centred 1240px desktop chrome.
- Venue sheet: same map chrome, with viewport-edge sheet alignment.
- Landing: full-bleed canvas with one centred hero/action composition.
- Plan: full-bleed canvas with one centred form column.
- Profile and profile lists: centred 1240px shared shell.

Tonight Arc has no container accent border. Accent border styling remains only
on the selected-chip state.

## First visit and regressions

True prompt winners were the same before and after:

| Width | Winning prompt |
| --- | --- |
| 390 | Analytics consent |
| 768 | None |
| 1280 | None |
| 1440 | None |

Both first-visit phases began with empty prompt-related local and session
storage. Their setup did not complete tour or onboarding state, decide
analytics consent, or read, write, or clear prompt budget. At 390, full
analytics copy and Privacy link remain visible, and Allow and No thanks remain
equal 44px actions. Visual weight was reduced by removing notice elevation,
backdrop blur, and filled action surfaces. Its measured box changed from
12-378px, 116px high to 12-378px, 120.13px high. The notice remains
dismissible.

Phone map checks passed:

- Chrome from topbar top to Arc bottom: 162px, within the 164px budget.
- Filter rail: 310px scroll width and 310px client width.
- Venue captions: 125px scroll/client width and 14px scroll/client height,
  with clipped overflow disabled.
- Before, analytics notice and map credit overlapped by 38px. After, notice
  occupied y=577.88-698px and credit y=530-570px, with zero overlap. Attribution
  expanded successfully.

`components/PubMap.tsx` has zero changed lines in this work.

## Profile Options

Desktop Options reuses the portalled `SiteNavMore` pattern. Render and route
checks cover working Edit profile, Analytics choices, About, Privacy, Terms, and
signed-in-only Sign out actions. Analytics choices targets the live account
control. Browser checks also cover keyboard entry, Escape focus return, exact
destinations, and signed-out storage after Sign out. `/help` and `/settings` do
not exist and are not listed; no About link is mislabeled as Help.

Signed-in profile contexts contain a Supabase session and no local
`pubmax_handle`. The before phase therefore records the ownership defect instead
of hiding it with a second identity. The after phase derives ownership from the
account handle, renders the owner surface at every width, and shows the Options
menu at desktop widths.

The Profile Options regression first failed against the pre-fix production
build while waiting for `#account-settings`, then passed against the final
production build in 6.3 seconds with all menu actions exercised.
