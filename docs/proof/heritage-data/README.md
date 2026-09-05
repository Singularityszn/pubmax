# Three historic-directory cards, before and after, at 390 and 1440

Rendered proof for the captain's audit of 5 September 2026, findings F05, F06
and F07. Every shot is `/historic/<slug>` in light theme with reduced motion,
phone shots at 390x844 device scale 2 and desktop shots at 1440x900 device
scale 1. `before` is the branch point, `1ce2ccc88`; `after` is this branch.
Both sides are served by `next dev` on an isolated dist directory, because what
is being proved is server-rendered copy rather than anything a production build
changes.

The readings beside each shot are read off the page after it is taken and are
saved whole in `readings-before.json` and `readings-after.json`. `chips` is the
meta row under the actions, in document order.

| card | route | before: chips | after: chips |
| --- | --- | --- | --- |
| The Queens Arms | `/historic/the-queens-arms` | `1846` · Westminster | `Founded 1846` · Westminster |
| The Cheshire Cheese | `/historic/the-cheshire-cheese` | `19th century` · Westminster | Westminster |
| Cheshire Cheese | `/historic/cheshire-cheese` | 404 | `19th century` · City of London |
| The Captain Kidd | `/historic/the-captain-kidd` | `1701` · Grade II · Tower Hamlets | `Linked to 1701` · Grade II · Tower Hamlets |

| card | flag | before | after |
| --- | --- | --- | --- |
| The Queens Arms | page says "seeded heritage route" or "reference stop" | **yes** | no |
| The Cheshire Cheese | page says "Crutched Friars" under a Westminster label | **yes** | no |
| Cheshire Cheese | page says "Crutched Friars" under a City of London label | n/a (404) | yes |
| The Captain Kidd | page prints 1701 | yes | yes |

## What each row shows

**F05, The Queens Arms.** Before, the card's only sentence was "Pimlico pub
from 1846; a useful Victorian reference stop for the seeded heritage route", a
note we wrote to ourselves. After, it reads "Victorian Pimlico pub from 1846."
The date survives and is now labelled as the founding date it is.

**F06, the Cheshire Cheeses.** Before, one card carried a Westminster label
over a description of a pub at 48 Crutched Friars in the City of London, and
`/historic/cheshire-cheese` did not exist. After, the Crutched Friars pub has
its own card, its own venue id, its own coordinates and the borough its own
description names, and the Strand pub keeps only the line that is about it. Ye
Olde Cheshire Cheese on Fleet Street was already distinct and is untouched.

**F07, The Captain Kidd.** Before, the chip read `1701` beside a Grade and a
borough, in the slot a reader takes for the pub's age, and the index sorted the
pub among the oldest in London on it. 1701 is the year the pirate the pub is
named after was hanged. After, the chip reads `Linked to 1701`: the date is
still shown, worded as the event it is, and it orders nothing.
