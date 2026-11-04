# Pub Pal cheapest-price captions

The live cheapest-pint answer showed amounts beside only `On record`.
Its answer also claimed that every card showed its source.
The base is `445df3a6bc85f2403f984a5f4a32e3e62d9731ff`.

## Reproduction

The captain reproduced the gap on production at phone and desktop widths.
The regression then sent `Cheapest pint near Soho` through the real chat HTTP handler and chat client.
It mounted the accepted response with the real `AnswerCard`.
The recorded £5.20 card displayed `The Queen’s Head`, its walk time and `On record`.
The assertion for its recorded `Pint Prices` publisher failed before the repair.
The separate answer-copy tests also rejected the unconditional source claim before its removal.

## Repair

The adapter joins each ranked card back to its original venue by id and exact amount.
It uses the existing selected-price, serving and receipt readers.
The note retains its walk time and adds the recorded drink and stated serving.
Missing drink and serving facts remain explicit.
The source caption names the recorded publisher and source-read day.
It does not infer a source URL from a publisher name.
The public sources list uses those same card sources.
The answer count no longer promises a source that a record might not contain.

Ranking, price eligibility, amounts, ties, open-venue proposals and Plan handoff remain unchanged.
The tests retain the separate price clocks and unknown-serving rule.
The equal-price fixture uses different publishers and days for two pubs.
The mounted HTTP case verifies that rendering does not trigger navigation.

## Checks and limits

The focused five-suite run passed 725 tests.
The added public HTTP-to-card case, handler custody assertions and existing answer checks passed.
Scoped ESLint and the focused TypeScript check passed.
The proof used keyless local handlers and public committed records.
It made no provider request, public write or automatic navigation.

No full verifier, native pipeline, product compilation, browser or publication ran for this repair.
Final browser layout and hosted checks remain pending.
The existing answer-copy assertion in `askRoute.test.ts` is the only test-file overlap with the separate routing lane.
Its new routing tests are unchanged.
