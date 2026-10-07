# Today and Tonight parity, 7 October 2026

This record describes the Today lane of the supplied Grok review. It does not claim current production behaviour after publication.

## Reproduction

A read-only browser visit to `https://pubmaxxing.com/today` showed "Nothing on tonight's list yet." The same browser then opened `/tonight`. That page showed the sourced "Pubs people are talking about" section, led by The Devonshire. Its primary event lane was also empty. No production write occurred.

The review grouped two different things under "listings". The current Today page already used the merged What's-On and Out event helpers. It did not compose Tonight's sourced pub suggestions. The Day segment pointed to `/today` correctly. Primary Tonight still owns both pages under `components/nav/navigationModel.ts`.

A keyless local Before visit showed "Live listings not set up yet." This differs from the configured production reading. The local result is evidence of absent provider configuration, not an empty live event feed.

## Change

The Today server page reads the same bounded, sourced pub suggestions as Tonight. It sends only the suggested pubs' map-selectable IDs to the client. The existing Tonight renderer supplies the source links, observation dates, map links, and unmatched-pub disclosure.

Today shows these suggestions when it has no event picks and no picks excluded by the reader's filters. Confirmed event picks keep their existing presentation. The suggestions remain a separate pub section. A failed or unconfigured event read keeps its reason beside them. An answered empty event read says "No confirmed events listed tonight."

The change adds no event-provider fetch in the browser. It changes no primary navigation destination, map data, provider configuration, migration, or production setting.

## Proof

- The first rendered regression failed before implementation because Today omitted the supplied pub suggestion. It passed after implementation.
- The focused Today suite passed 33 tests across three files. It covers sourced fallback, an event read failure, existing confirmed event picks, listing helpers, and personalisation.
- The browser journey passed on a 390 by 626 viewport. It compared Today and Tonight's visible pub names and source links, then checked the Day segment and the link back to Tonight.
- The first browser attempt used a single pre-hydration tap. It failed without navigating. The spec now uses the documented tap-and-observe retry idiom.
- The final private `NEXT_DIST_DIR=.next-prod` production build exited 0. The browser journey passed again against that build, with one test in 1.7 seconds. The targeted ESLint check and `git diff --check` also exited 0.
- Full `npm run verify`, final-head publication validation, and GitHub publication belong to the combined branch run. This lane did not claim those checks independently.

## Limits

The browser parity journey runs keyless against the committed suggestions. It does not prove a configured provider-backed event refresh or an authenticated preview write. The Today document keeps its existing five-minute ISR window.

The combined branch's existing `TonightHypedPubs` row reservation clears the phone create action. This lane reuses that renderer and does not reserve a second outer lane. Final phone screenshots must come from the combined build.

Local evidence is under `artifacts/today-parity/` in this lane's worktree. `today-before.yml` records the keyless Before reading. `today-before-phone.png` shows that prior surface from the original browser session. The production After capture uses a fresh browser context.
