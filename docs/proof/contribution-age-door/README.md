# One rule: the recorded adult tap is the age answer on the price path

Proof for the captain's cut of 5 September 2026 ("one rule"), over finding P01
of the contribution battle test. `POST /api/price-submit` and every other route
behind `resolveContributionIdentity` refused an account that held no date of
birth, and the surface it sent that account to (`/u/you`, the handle claim)
stores none, so the price path was a door with nothing behind it.

The gate now asks the age question the 10 August rule wrote down
(`needsAdultSelfAssertion`): a stored date of birth, or the recorded one tap.
A missing handle and a missing age answer are two findings with two doors.

Every shot is a production build of this branch, signed in through
`e2e/helpers/authDoubles.ts` as account A, at The Old Bell Tavern
(`venue-1kt3p9o`), light theme, reduced motion, with `/api/price-submit`
answered by a route mock in the shape the gate answers. The drinker has typed
£4.40 and tapped Log it. Shots are 390x844, 768x1024 and 1440x900, taken by
`e2e/contribution-age-door.spec.ts` under `PW_PROOF_SHOTS=1`; each width is
driven from its own navigation, because the phone sheet unmounts above 640 and
a resized shot would picture a surface that width never draws.

| file | what it shows |
| --- | --- |
| `after/age-door-390.png` | the age door as the phone's bottom sheet |
| `after/age-door-768.png` | the same door centred on the tablet |
| `after/age-door-1440.png` | the same door centred on the desktop |
| `after/handle-door-390.png` | the handle door, asking for a handle alone |
| `after/handle-door-768.png` | the handle door on the tablet |
| `after/handle-door-1440.png` | the handle door on the desktop |

There is no `before` lane for the age door: before this branch it did not
exist, and the refusal opened the handle door instead. The handle door's
retired copy at `949e0592b` was "Finish account setup" over "Choose a public
handle and add your date of birth before contributing. The setup dialog
collects both together.", which named a birth date that surface never collects.

Two defects were measured and fixed while shooting, both older than this
branch and both visible in the first capture:

1. **The dialog was the drawer's, not the viewport's.** At 1440 and 768 the
   panel sat above the viewport with only "Not now" on screen. The desktop map
   drawer it opens from is a transformed, filtered box, and a transformed
   ancestor is the containing block for `position: fixed`. The dialog is now a
   `document.body` portal, the idiom `AccountOnboarding` already uses; the
   phone never showed the defect because its sheet is already body-level.
   `e2e/contribution-age-door.spec.ts` measures the panel's box inside the
   viewport at all three widths.
2. **A door that asks printed its own question again in alarm colours.** The
   gate's refusal sentence was rendered as a red error under a heading and a
   button that already said it. `contributionGateError` drops the gate's OWN
   sentence and still prints one the gate did not write.
