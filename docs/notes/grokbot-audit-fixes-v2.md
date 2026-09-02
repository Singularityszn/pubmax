# fm/grokbot-audit-fixes-v2: what was kept, what was dropped

A rebuild of source branch `fm/grokbot-audit-fixes` onto current `main`, carrying the
standing verdict's KEEP list only. The original branch is not merged and is not
the base. This history contains source commits cherry-picked with `-x`, rebuild
commits created while recomposing the keep list, and pipeline-owned fix commits.
The `-x` trailers apply only to the source cherry-picks. Kept entries use
reachable commits from this rebuilt history. Dropped entries use the original
source branch and commit subject because their original refs are not reachable
in this worktree.

## Kept

| reachable commit | what it settles |
| --- | --- |
| `7522be8062a71247a978a5ad5119ae0e2ba0cb8b` | Out source honesty: the real source is credited, and a non-pub is not called a pub. |
| `d0e9d262c1e4d8872b9378eb6d1bae6a52b25425` | The follow-up to it: the badge stops naming a place kind. |
| `415bdb593e616f4cf411fbbb6d7022fe1a098d1f` | Price freshness budget 2160h to 720h, so a 58-day-old pint stops reading as fresh. |
| `3db458eb855b410c75315a81b2daa756af720f32` | Plan input types, and the Wanted list asks only when somebody is there. |
| `014f030d78489c1bc5836f8ba4146f636d3c014f` | The pint budget is read from the registry rather than a number typed into a test. |
| `2357da1246519d4e6802aceb26e1ca5939779b9b` | Borough coverage and zone lines: a shared fact said once, and the zone that surprises explained. |
| `74bdc3bfb6c529c2fee5586b85b16745e427d106` | Map nav parity: the landing header and footer send Map where the phone tab bar sends it. |

Plus one reachable commit of this rebuild's own, `54ce2cb1178da318b18bdb9922dd99fa2c27480e`
(`test(out): read the venue badge label from the constant that owns it`),
explained under Findings.

## Dropped

| source branch and commit subject | why |
| --- | --- |
| `fm/grokbot-audit-fixes` - source subject: What's-On Sunday scoping | Fights #1264. |
| `fm/grokbot-audit-fixes` - source subject: Tonight listing kinds | Fights #1264. |
| `fm/grokbot-audit-fixes` - source subject: The AGENTS.md commit | It rewrites the landing bullet back to "`Find my pint` is the ONE primary action on `/`", which is the pre-#1280 state: #1280 made Pub Pal the front door and `main` says so. Carrying it would regress the record rather than document this branch. |

## Findings

**The map-nav-parity half is NOT superseded, so it is kept.** The verdict asked
for a comparison against today's map camera fix in reachable commit
`51e18e4ccc9c292afae992c7bc0ada6f5ce94f05`.
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

**`components/plan/TonightAgentPanel.tsx` is gone from `main`.** The reachable
plan-input commit above added its type before reachable commit
`da334c3106d90dfbe1dd76a74d762350fba4f706` (#1278, "keep one planning entry")
deleted it. The
deletion is accepted and the hunk with it; the other eight files of that commit
apply unchanged.

**The source branch was red before this rebuild started.** The source subject
`The follow-up to it: the badge stops naming a place kind` renamed the venue
badge to "On PUBMAXX" and never updated
`__tests__/outDesktopGrouping.test.ts`, which still asserted the old
">PUBMAXX venue<" literal. This branch's own commit fixes that by reading the
constant instead of a literal, and adds the assertion the rename was actually
about: the badge may name neither "pub" nor "venue".

## Verification

No pipeline validation run or push occurred at the time of writing, per the
prep instruction. The seven kept commits' own fences plus the adjacent Out,
landing and voice fences were run locally: `outSourceHonesty`,
`priceFreshnessHonesty`, `planInputTypes`,
`wantedListAuthGate`, `boroughCoverageStatus`, `zones`,
`priceSourcePresentation`, `landingMapNavParity`, `outListings`,
`outAttribution`, `outDesktopGrouping`, `tonightOutListings`, `coreUiAudit`,
`landingFindMyPintHierarchy`, `emDashLaw`, `frictionVoice`. All green.
