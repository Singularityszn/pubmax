# Client map dispatch repair

Recorded on 4 November 2026 during the authorised review fix.
The starting HEAD was `a34f97f3865e5fb66a0a8e8d0769a0ab685d6b3f`.
The evidence covers the working changes in this fix, before the executor creates a child commit.

The required invariant comes from the recorded `client-map-policy-bypass` fix decision.
Evidence instructions must preserve service priority and the named map subject.
The typed chat, typed voice, spoken voice and named resolver share these decisions.
Current recommendations and active-plan next-stop guards retain their existing priority.

## Mounted failure before product edits

The new `palChatMapDispatch.test.tsx` mounted the real `PalChat` component.
It submitted each request through the visible composer and form submit control.
It executed the real classifier, named target parser, venue resolver and chat session.
Only external transport, venue data, browser navigation and unrelated presentation were replaced.

The three original cases failed before any product edit:

| Request | Observed navigation | Required result |
| --- | --- | --- |
| `Date night. Show the map.` | `/map` | Send the original request to chat. |
| `Any Tube delays? Show me the map. Show the source and date for any price you use.` | `/map` | Send the original request to chat. |
| `Show The Harp on the map. Show the source and date for any price you use.` | `/map` | Open `/map?sel=venue-1bz7oic`. |

The Harp record is an external venue-data fixture using the listed identifier from the supplied reproduction receipt.
The transport records the actual request body from the real client session.
The test checks the complete raw query in that body and in the visible transcript.
The assertions would reject automatic navigation for service requests and generic navigation for the named request.

The genuine red log is `artifacts/client-map-fix/mounted-before.log`.
The command was:

```sh
node node_modules/vitest/vitest.mjs run __tests__/palChatMapDispatch.test.tsx --maxWorkers=1 --retry=0 --reporter=verbose
```

## Correction and call paths

The existing semantic-request policy now runs at the shared navigation parser boundaries.
The resolver therefore receives the named subject without price-evidence instructions.
The shared classifier checks the existing deterministic router before generic navigation.
The router owns service selection, including unsupported-price refusals, hours, discovery, mood, group, area and budget constraints.
No second service classifier or acknowledgement list was added.

The dependency direction is `palVoiceTranscript` to the pure router, then to the map and request policy leaves.
The imported graph contains no server-only runtime dependency.
The classifier changes its local parsing text only.
The typed and voice callers still retain the complete original request.

The named resolver, retained-choice parser and discovery parser all use the same semantic-request policy.
The two protected UI callers and the protected Plan, tool, R6 and caption files remain unchanged.

## Focused results

The initial focused command selected these 13 suites with one worker and no retries:

```sh
node node_modules/vitest/vitest.mjs run \
  __tests__/palChatMapDispatch.test.tsx __tests__/palMapAsk.test.ts \
  __tests__/palVoiceTranscript.test.ts __tests__/pubPalVoice.test.tsx \
  __tests__/palChatClient.test.ts __tests__/palChatRetiredAsk.test.tsx \
  __tests__/palMapFailureIsolation.test.tsx __tests__/askRouter.test.ts \
  __tests__/askRoute.test.ts __tests__/pubPalChatRoute.test.ts \
  __tests__/conciergeIntent.test.ts __tests__/conciergeWhatsOn.test.ts \
  __tests__/askVenueHours.test.ts --maxWorkers=1 --retry=0
```

Eleven suites passed with 1,476 tests.
The two new or extended suites exposed test setup and expectation errors.
These included retained cache data, incomplete asynchronous settling and missing clause punctuation in generated requests.
A classifier-only desk assertion also required a service sentence that did not match the existing named-target grammar.
The intermediate log retains all 25 failures and nine resulting jsdom errors.
The product correction remained unchanged during these test corrections.

Only the two affected suites ran again:

```sh
node node_modules/vitest/vitest.mjs run \
  __tests__/palChatMapDispatch.test.tsx __tests__/palVoiceTranscript.test.ts \
  --maxWorkers=1 --retry=0
```

All 167 tests passed on that execution, with no unhandled errors.
Together, the two executions establish 1,643 passing focused tests across 13 suites.
This is reused evidence across two executions, not one clean execution of all 13 suites.

The mounted suite covers 84 cases.
It checks raw service requests, named-map resolution, acknowledgement commands, prior Camden context, retained-choice focus and active-plan guards.
The extended parser and classifier tests check leading and trailing evidence, negation, service requests and next-stop priority.
The existing mounted voice suite passed without changes.
Its SDK transport remains a test double.

Scoped ESLint passed for all seven changed TypeScript files with `--max-warnings=0`.
The two subsequently corrected test files passed scoped ESLint again.
Focused TypeScript passed with the repository's ambient declarations and the changed files' imports.
The first temporary type configuration omitted those ambient declarations.
Its two declaration errors remain in the intermediate type log.

## Dependencies and evidence custody

This worktree initially had no `node_modules` directory.
The fix used a real local `npm ci --ignore-scripts --no-audit --no-fund` installation.
No dependency link or system installation was used.
The package and lockfile hashes remained unchanged:

```text
package.json      a45af88f650b428894b9b216d29178687edc2bf9dc3a6f4ce1377184863337c5
package-lock.json b7b57a95b7c648985e7629ceb22fe13f0d9ba04df19b3514cc6c208a07494bca
```

Tools were Node 26.13.0, Vitest 5.0.5, ESLint 10.14.0 and native TypeScript 7.0.2.
Free space stayed above the required 20 GiB reserve.
The temporary focused type configuration was removed after execution.

Logs and source hashes remain under `artifacts/client-map-fix/`.
A separate test-evidence copy is under `/Users/karanmanoharan/.no-mistakes/evidence/01M6KG5SPKPXTN8CB7RNMPRZNJ/client-map-fix/`.
The original red log and intermediate failures remain unchanged.

No production build, app server, browser acceptance, microphone, provider, push or pipeline-control command ran during this fix.
The mounted tests do not establish browser destination rendering or live provider operation.
The outer Test phase still owns production and browser acceptance.
