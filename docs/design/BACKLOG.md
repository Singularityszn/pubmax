# Design backlog

Open design debt and raised design decisions. A `docs/proof/` directory records
one finished measurement and nobody re-reads one, so anything still OPEN when a
review lane closes belongs here instead. `docs/DESIGN_SYSTEM.md` points at this
file from its "Where each law is fenced" index.

A row leaves this file when it is shipped or withdrawn, and the commit that
closes it says which. A row is not a plan: it names the defect, where it is,
and the one thing that makes it hard.

## Open debt

| What | Where | Why it was not taken |
|---|---|---|
| The profile editor's own form buttons (`Rename handle`, `Save private details`, `Create private Memory`) wear 12px corners at weight 750 rather than the `--control-*` row | `components/profile/PubmaxxAccountHub.tsx`, `components/profile/PrivateIdentityEditor.tsx` | One editor family, recorded during the #1597 sweep rather than moved, because #1591 was live in the same component tree. |
| Number-square chips want one family: the planner's stop count at 10px, the pubs zone picker at `--radius-sm` on 44px squares | `components/plan/PlanIntake.tsx`, `app/pubs/` | A number square is neither a text button nor a pill, so it needs a decision about which family it joins before either surface moves. |
| The five quick price chips wrap 4 + 1 at 390 (the row is 268px, a chip 60px, five need 324px) | the Pint Drop and price-submit composers | The ladder is a policy in `lib/`, not a style, so this is a product change rather than a layout fix. |

## Decisions raised and still open

| Key | The question | Where it stands |
|---|---|---|
| `consent-before-answer` | The analytics consent card is the first thing a new reader meets at 320 and 360, over the answer card on `/` and over the first list on `/near` and `/tonight`. PlanAstra section 3 moves it to the third screen. | Its own lane. A flow decision rather than a defect, so no sweep may take it in passing. |
| `map-kind-chips-behind-filters` | The kind chips row at 641px and up belongs behind a desktop `Filters` control (PlanAstra item 9). | A map lane. It needs a new control and it moves every spec that clicks a chip today. |

## Closed

| Key | Answer | Where |
|---|---|---|
| `head-primary-on-form-screens` | A form screen paints no head primary: the form's own submit, beside the field it submits, is the one painted control. | Captain, 7 September 2026; applied in #1597 and written into `docs/design/LAUNCH_SCREENS.md`'s rules list. |
