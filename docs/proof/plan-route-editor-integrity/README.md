# Plan route editor integrity at 390x844, 768x1024 and 1440x900

Rendered proof for two rows of the core-loop battle test of 5 September 2026:
D02 (silent data loss in the route editor) and M03 (a triple-clicked Save
sent two PATCHes and printed two contradictory lines). `before/` is a
production build of origin/main at `1ce2ccc88`; `after/` is the same build of
this branch. Both were shot on a keyless local server with
`PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1`, device scale 2, light theme, analytics
consent answered. The plan is a three-stop route (Arnos Arms, The Bohemia,
The Elephant Inn) and `/api/plans/generate` is answered in the browser with the
same three pubs, stops 2 and 3 the other way round, each carrying one backup,
which is what the deterministic generator does for a saved plan.

Each state has a page shot (`<state>-<w>x<h>.png`) and a clip of the route
section's head, the editor and its line (`<state>-editor-<w>x<h>.png`).

## The states

| state | before | after |
| --- | --- | --- |
| `editor-open` | The editor shows the GENERATED route: stops 2 and 3 re-sequenced, "1 backup ready" each, Save already enabled although nothing was chosen, and the line reads "Fresh route preview ready". At 390 the rail runs through the card. | The editor shows the STORED route in stored order, "3 backups ready" per stop, Save disabled as "Choose a route change" until a stop is swapped, and the line reads "Your saved route, with a backup for each stop". The card covers the rail; the line sits with the heading. |
| `after-triple-save` | Three taps in one task on Save: two PATCHes (200 then 409). The status line says the route was saved while the error line says nothing was saved. | One PATCH. One line: "Route saved. The new order is now canonical." |
| `after-reload` | The saved route renders. | The saved route renders and no editor opens on a stale draft. |
| `editor-reopened` | The editor opens on the generator's answer again, with the pub saved a moment ago gone from the draft. Saving would write over it. | The editor opens on the saved stops. |
| `stale-save` | Another tab saved first. The 409 keeps the editor open on a draft that can never be saved and prints two lines. | The draft is dropped, the editor closes, the route the other tab saved renders, and one error line names what happened and where the route is. |

## What the phone gained

At 390 the two editor actions stack as full-width rows, because the disabled
label is wider than the row allows and the pair used to wrap ragged. The
notice line moved from the rail's left edge to the heading's own left edge on
the phone, matching the desktop where it already sat under the heading.

## What did not change

The anchored lane still offers a fresh route with Stop 1 kept, because the only
edit a grounded route admits is a regenerated one under its proof. The swap
control, the card, the buttons and every token are the shipped ones.
