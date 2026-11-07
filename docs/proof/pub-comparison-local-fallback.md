# Pub comparison local integration evidence

The two remaining scenarios have integration coverage. Live local Supabase validation remains unavailable. No product behaviour changed.

This report supplements the 17 successful live scenarios at commit `96532c73ed0337009a2a7a072d1c4050faf43144`.
Those earlier results are historical evidence, not a new run of those scenarios.

## Local blockers

On 7 November 2026, `docker info` and `supabase status --output json` could not connect to `/var/run/docker.sock`.
`docker context ls` listed only that default connection. `colima status` reported that Colima was not running.

The previous attempt in this worktree recorded a Colima socket path of 136 characters. macOS requires fewer than 104 characters.
The evidence is `disposable-vm.log` under `/Users/karanmanoharan/.no-mistakes/evidence/01M6TVGAVKYM79PWTAJKD58C51`.
A shorter VM directory outside this worktree would violate the assigned workspace boundary. No new VM was started.

Successful live walking comparisons need an ORS credential or populated walking cache.
No isolated credential or disposable Supabase cache was supplied. The provider has a fixed remote URL.
The tests make no paid provider calls and use no hosted Supabase project.

## Private poll fallback

`__tests__/pubComparisonPoll.integration.test.tsx` mounts the real sharing component and uses the real authenticated request helper.
The requests execute the real inbox and thread handlers with the real memory stores.
Two test identities own profiles, confirm adult status, and follow each other through the real stores.
The external identity verifier and browser token source are test doubles. These identities are not Supabase accounts.

The tests check these observable contracts:

1. Alice sends a pub poll. The server commits it, but the transport loses the reply.
2. Alice retries with the same request identity. Bob receives exactly one poll with the expected pub labels and public links.
3. Bob answers the poll. Alice receives the aggregate result without Bob's identity or answer index.
4. An account change aborts a pending conversation read or send. The old response cannot populate the new account's controls or success message.

An aborted send can already exist on the server. The test checks that Bob can still receive that committed poll.
The expected labels and links come from the sharing contract. Duplicate polls, private order details, and stale success messages fail the tests.

These tests execute local handler responses. They do not replay a captured authenticated Supabase session.
Supabase authentication, database permissions, durable retry behaviour, and realtime delivery remain outside this fallback's coverage.

## Walking fallback

`__tests__/pubComparisonWalk.integration.test.tsx` executes the real comparison HTTP handler, comparison service, ORS decoder, walking cache, and result renderer.
The external provider boundary replays geometry from `e2e/fixtures/soho-walk-route.json`.
Its companion Markdown file records the public API capture on 26 October 2026.

The recorded first leg measures about 119 metres. Both legs measure about 156 metres.
At the documented 4.8 kilometres per hour pace, the rounded times are one minute and two minutes.
The first leg ends after coordinate 11. Including coordinate 12 crosses the rounding boundary and gives an incorrect test expectation.

The fixture starts at The Lyric. The test supplies that start in a test meeting-point catalogue.
It does not add a production meeting point or claim a route from an unrelated landmark.
The test prices of £7 and £5 are synthetic. They are not current price claims for the named pubs.

The rendered result must show £2 less and one minute more walking for the second pub.
A synthetic provider duration of two hours checks that the result uses the shared walking pace.
A second comparison must return the same answer from the real memory cache without another provider call.

This fallback does not prove current provider availability, road access, or successful routing in the running production app.

## Focused verification

The initial new tests failed because their fixture boundary and message DTO expectations were incorrect.
The corrections use the recorded first-leg boundary and the public `viewerOptionIndex` field.
The message handler also normalises line breaks to spaces. The tests preserve that existing behaviour.

The final focused command passed with four tests across two files:

```sh
./node_modules/.bin/vitest run __tests__/pubComparisonWalk.integration.test.tsx __tests__/pubComparisonPoll.integration.test.tsx
```

No broad test suite, static checks, builds, deployments, or pipeline operations ran in this phase.
No browser or server children were started. The test runner exited successfully.

## Required PR disclosure

The PR body must retain this limit: private polls use real local handlers with memory stores and test identity verification.
Two disposable Supabase accounts could not run because Docker was unavailable and the permitted VM path exceeded the macOS socket limit.
Successful walking comparisons use recorded geometry through the real handler and renderer. Live provider and durable-cache validation remain unverified.
