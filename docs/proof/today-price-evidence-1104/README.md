# Today price evidence

The live `/today` cards showed amounts without their own drink, serving, publisher and read date.
The quiet-pint card showed only the separate history citation beneath an amount.
The base is `445df3a6bc85f2403f984a5f4a32e3e62d9731ff`.

## Reproduction

Root's Browser audit reproduced both gaps on production at 390 pixels.
The mounted regression then rendered the real cards from their public derivations.
It controlled no internal component.

Before the repair, the ordinary row contained `The Test Arms£4.80`.
It failed the required `Fixture lager · Pint` assertion.
The quiet row failed the same assertion and carried only its history citation.
A third regression rejected a contributor caption that called a report a listed source read.

## Repair

Each caption reads the evidence selected for its displayed amount.
The existing selection, legacy-source, serving and date readers remain authoritative.
An equal-price contributor report cannot borrow a listed row's drink, publisher or date.
Equal-price listed rows retain the first selected row's facts.
Missing facts remain explicit.
The shared source caption keeps a recorded publisher label when its link is absent or unsafe.
Report dates say when the price was seen.
Listed dates say when the source was collected.

Quiet-pint display amounts and qualified ranking amounts remain separate.
Both Today and Tonight supply the shared quiet-pint card with the amount's own evidence.
The history link is labelled as history.
An absent or mismatched price record cannot borrow that history source.

## Checks and limits

The focused six-suite run passed 63 tests.
This includes ten mounted price-evidence cases and the existing ranking, date and locality cases.
Scoped ESLint and the focused TypeScript check passed.
The tests use literal expected amounts, sources, serving labels and dates.
They reject borrowed facts, changed ranking, unsafe links and invented history-based price evidence.

No full verifier, production compiler, browser, deployment or public write ran for this repair.
Browser layout and final hosted checks remain pending.
