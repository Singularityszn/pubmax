# fm/grokbot-audit-fixes-v2: what was kept, what was dropped

A rebuild of `origin/fm/grokbot-audit-fixes` onto current `main`, carrying the
standing verdict's KEEP list only. The original branch is not merged and is not
the base: every commit here was cherry-picked with `-x`, so each one names the
commit it came from.

## Kept

| from | what it settles |
| --- | --- |
| `1ab3c35d4` | Out source honesty: the real source is credited, and a non-pub is not called a pub. |
| `9cd5f2bec` | The follow-up to it: the badge stops naming a place kind. |
| `de413bb32` | Price freshness budget 2160h to 720h, so a 58-day-old pint stops reading as fresh. |
| `efafbd2ff` | Plan input types, and the Wanted list asks only when somebody is there. |
| `2524e9c12` | The pint budget is read from the registry rather than a number typed into a test. |
| `18e6dc144` | Borough coverage and zone lines: a shared fact said once, and the zone that surprises explained. |
| `11d1da22b` | Map nav parity: the landing header and footer send Map where the phone tab bar sends it. |

Plus one commit of this rebuild's own, `test(out): read the venue badge label
from the constant that owns it`, explained under Findings.

## Dropped

| from | why |
| --- | --- |
| `32b6433f5` | What's-On Sunday scoping. Fights #1264. |
| `a7bb297b6` | Tonight listing kinds. Fights #1264. |
| `a7484068c` | The AGENTS.md commit. It rewrites the landing bullet back to "`Find my pint` is the ONE primary action on `/`", which is the pre-#1280 state: #1280 made Pub Pal the front door and `main` says so. Carrying it would regress the record rather than document this branch. |

## Findings

**The map-nav-parity half is NOT superseded, so it is kept.** The verdict asked
for a comparison against today's map camera fix on `fm/live-auth-map-bugs`.
They are different faults with no overlap: the camera fix is
`lib/mapCameraFocus.ts`, where two owners of the canvas's one focus prop each
kept a counter starting at 1, so the first area pick after a locate was read as
a move already made and dropped. Nav parity is a landing HREF: the header's
"Map" and the footer's "The map" sent a viewer with no stored city to
`/choose-city` while the phone tab bar sent everyone to `/map`. Neither touches
the other's file, and fixing one leaves the other's symptom exactly where it
was.

**No separate LandingPage hero hunk exists in this branch.** The verdict listed
one as a drop. The only `components/landing/LandingPage.tsx` change on the
source branch is inside the nav-parity commit, and it touches the header nav
link, the footer link and the warm-props split - it explicitly leaves the three
"Open the map" arrival calls to action on `/choose-city`, which is the law
#1280 cares about. Nothing was dropped on that account because there was
nothing there to drop, and nothing was reinterpreted: the hero is untouched.

**`components/plan/TonightAgentPanel.tsx` is gone from `main`.** `efafbd2ff`
added `type="text"` to an input in it, and `da334c310` (#1278, "keep one
planning entry") deleted the file. The deletion is accepted and the hunk with
it; the other eight files of that commit apply unchanged.

**The source branch was red before this rebuild started.** `9cd5f2bec` renamed
the venue badge to "On PUBMAXX" and never updated
`__tests__/outDesktopGrouping.test.ts`, which still asserted the old
">PUBMAXX venue<" literal. This branch's own commit fixes that by reading the
constant instead of a literal, and adds the assertion the rename was actually
about: the badge may name neither "pub" nor "venue".

## Verification

No validation run and no push, per the prep instruction. The seven kept
commits' own fences plus the adjacent Out, landing and voice fences were run
locally: `outSourceHonesty`, `priceFreshnessHonesty`, `planInputTypes`,
`wantedListAuthGate`, `boroughCoverageStatus`, `zones`,
`priceSourcePresentation`, `landingMapNavParity`, `outListings`,
`outAttribution`, `outDesktopGrouping`, `tonightOutListings`, `coreUiAudit`,
`landingFindMyPintHierarchy`, `emDashLaw`, `frictionVoice`. All green.
