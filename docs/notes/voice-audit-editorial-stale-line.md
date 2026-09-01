# The withheld-week line: the ruled composed form

Two branches fixed the same finding differently, and the captain's ruling of
2026-09-01 is that the final form takes BOTH halves. This note exists so a
later validation round does not relitigate it.

## What each branch had

`fm/live-auth-map-bugs`, from the live UI audit, replaced
`EDITORIAL_STALE_LINE` with **"No fresh picks to show just now."** The finding
was that "Picks need a fresh check." describes our own maintenance to a
drinker. The new sentence also refuses to claim the week is empty, which a
withheld snapshot cannot know: it did not look.

`fm/voice-audit-remaining-surfaces`, this branch, replaced the constant with
`editorialStaleLine(snapshot)` printing **"Picks last checked 15 Aug."** from
the snapshot's own `generatedAt`. The finding was that one undated sentence met
the reader whether the snapshot was two days old or two months old, so the rail
read as a permanent apology rather than a fact.

## The ruling

Neither is wrong and they answer different halves of one honesty problem: what
the reader GETS, and HOW STALE the check is. The final form is both:

```
No fresh picks to show just now. Last checked 15 Aug.
```

Dating the check is the house provenance pattern, the same shape as
"Checked 6 minutes ago via Open-Meteo" on the drink-weather card.

## How it is carried here

`fm/live-auth-map-bugs` keeps its static line exactly as committed. It
validates first and does not reopen.

This branch carries the composition, and it does so WITHOUT rebasing onto that
branch. `EDITORIAL_STALE_LINE` is restored here with the bugs branch's own
wording, and `editorialStaleLine` composes it with the day. So the constant is
byte-identical on both sides: this branch produces the ruled line on its own
today, and when the bugs branch merges there is nothing left to conflict over.
Rebasing onto a branch that is about to go through a validation round would
have pinned this one to commits that round may rewrite.

A snapshot carrying no printable day keeps the first sentence alone.
`EDITORIAL_UNDATED_LINE` is gone with the composition: the first sentence is
already honest for that case, and a second apology in different words would
have been a third variant of the same admission.

Pinned by `__tests__/editorial.test.ts` and `__tests__/editorialRail.test.ts`,
both of which assert the composed string and that the first sentence never
becomes the empty-week claim.

## What to do when the two branches meet

The CONSTANT is byte-identical on both sides, so its value never conflicts.
Three hunks around it do, all comment-and-assertion adjacency, and each one
resolves to THIS branch's side because this branch carries the ruled form:

1. `lib/editorial.ts`, the comment above `EDITORIAL_STALE_LINE`. Take this
   branch's: it documents the composed line and the ruling. The bugs branch's
   comment describes the first sentence alone, which is now half the story.
2. `__tests__/editorial.test.ts`. Take this branch's block, which asserts the
   composed string and keeps the bugs branch's own two guards inside it: the
   constant is never the empty-week line, and never names our maintenance.
3. `__tests__/editorialRail.test.ts`. Take this branch's rendered assertion,
   and KEEP the bugs branch's two lines beside it rather than replacing them.
   They are compatible: that guard reads the CONSTANT, which is
   "No fresh picks to show just now." and contains none of check, refresh,
   stale or snapshot. Only the composed OUTPUT carries "Last checked", and
   nothing asserts the output is free of those words.

Nothing else in either branch touches this lane.
