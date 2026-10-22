# Tonight document diagnosis, 22 October 2026

The production document includes listing rows that Tonight rejects after the browser receives them.
This iteration records the baseline and the next change to test. It changes no application code.

The local head was `90864cf3ffd18001bc4db95e655868c55fbcda44`.
Production `/api/version` reported `e81aaa6a04b720ddb8ef4b909b35ffad445b0088` and deployment `dpl_H8cZfyzhPPUorvaNVF8hiddpwjxn`.
These are different builds. The production measurements describe that capture only.

## Document bytes

All figures count decoded UTF-8 bytes, without compression.
Inline script bytes count script bodies without an external `src`.
Flight bytes count the concatenated strings in `self.__next_f.push([1, ...])`.
Flight is the React data that Next.js puts inside the document for the browser.
JSON value sizes exclude property names and HTML escaping.

| Build | Route | HTML | Inline scripts | Flight |
| --- | --- | ---: | ---: | ---: |
| Local production build | `/` | 102,717 | 69,352 | 49,197 |
| Local production build | `/tonight` | 177,778 | 117,411 | 92,323 |
| Production capture | `/` | 101,782 | 68,637 | 48,724 |
| Production capture | `/tonight` | 271,877 | 209,708 | 176,271 |

The production gap is 170,095 HTML bytes. The local gap is 75,061 bytes.
The local build has no current listing rows and no configured Out providers.
An empty local answer would therefore understate the production cost of a listing change.

The largest production Flight record is the Tonight client element, at 137,989 bytes.
Its corresponding local record is 53,249 bytes.
The root document does not carry the Tonight client props.

| Tonight prop | Production JSON bytes | Local JSON bytes | Contents |
| --- | ---: | ---: | --- |
| `initialListings` | 85,501 | 761 | Both listing answers and the render clock. |
| `mapSelectableVenueIds` | 35,295 | 35,295 | All 2,250 selectable venue IDs. |
| `photos` | 8,125 | 8,125 | Pub, area, and London photo metadata. |
| `hypedPubs` | 5,383 | 5,383 | Twelve recommended pubs. |
| `quietPint` | 2,965 | 2,965 | The quiet-pint module. |
| `cheapPints` | 581 | 581 | Four priced pubs. |
| `softPlansWindow` | 4 | 4 | The window flag. |

## Rows that do not become pub listings

The production `initialListings.out.body.events` contains 78 rows and occupies 43,792 JSON bytes.
Only one row has a `venueId`.
The existing `filterTonightPubSurfaceRows` accepts that one row at the captured render time.
The accepted array occupies 565 bytes. The rejected rows account for 43,227 bytes of the array.
The first rejected row is a Ticketmaster theatre listing for SIX at Vaudeville Theatre.

The production What's-On answer contains 63 rows and occupies 40,645 JSON bytes.
All 63 rows have a venue ID.
The existing composition returns 64 secondary listing rows, zero primary rows, and an `empty` primary status.
The chain rows still feed chain blocks, grouping, counts, and alternative venue actions.
Removing chain rows would require separate proof of those behaviours.

`app/tonight/page.tsx` passes the full Out answer to `TonightClient`.
`lib/tonightOutListings.ts` applies the pub filter during composition.
This ordering serializes rows that the pub listing view cannot use.

The next smallest fix can apply the existing pub eligibility filter before serializing the initial Out events.
A regression test must preserve listing status, source dates, open plans, and rendered output.
The test must include unmatched, expired, and valid pub rows.
The captured production answer provides the before case with real supply.
This report claims no reduction before a fresh build measures the change.

## The map ID list needs a separate design

`loadMapSelectableVenueIds` reads all shipped map cells.
The page serializes that whole set, although the initial view asks about only its listing venues.
The root landing does not send that set.

A filter based only on initial listing IDs can break later reads.
`TonightClient` also checks new rows from browser revalidation and nearby listings against the same set.
A later fix must preserve those map links and acceptance actions.
The three states also matter. An unreadable index is `null`, a readable empty set denies links, and `undefined` permits browse links.

## Validation and measurement limits

The following checks completed.

- `npm ci` passed. The audit reported five high-severity vulnerabilities. This iteration changed no dependency.
- `NEXT_DIST_DIR=.next-tonight-payload-1022 npm run build` passed, including TypeScript and static page generation.
- `npx vitest run __tests__/tonightServerListings.test.tsx __tests__/tonightOutListings.test.ts __tests__/tonightPubSurface.test.ts` passed all 71 tests.
- The HTTP reproduction showed that the local Tonight document exceeds 1.5 times the root document size.

The repository performance helper measured both local routes with its tracked viewport, throttle, and sampling rules.
The installed Playwright headless binary was absent. The measurement used installed Google Chrome 154.0.8037.93 instead.
Each route took five measured samples after one discarded warm-up.

| Route | Server render median | Decoded script KB | Requests | Largest paint median | Layout shift median |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 88 ms | 877 | 47 | 288 ms | 0 |
| `/tonight` | 88 ms | 1,052 | 67 | 244 ms | 0 |

Every sample used the helper's `harness-ready` fallback and reported open `/api/pint-drops` requests.
The private server also lacked the full Playwright test environment and refused the durable Pint Drops read.
These figures are indicative. They do not establish budget acceptance or justify a lower ceiling.
The byte counts above come directly from complete HTTP response bodies and do not use the readiness fallback.
No performance ceiling changed. Full `npm run verify` remains for the implementation iteration before publication.

## Reproduction records

[baseline.json](baseline.json) retains the figures, property sizes, composition result, and all performance samples.
Raw HTML, decoded Flight, and temporary analysis scripts remain in the ignored `artifacts/tonight-payload-1022/` directory.
The analysis extracted the JSON element record containing `mapSelectableVenueIds` and measured each property with `Buffer.byteLength(JSON.stringify(value))`.
It passed the captured rows and `renderedAt` to the existing `tonightLedeComposition` and `filterTonightPubSurfaceRows` functions.

The temporary performance script imports `preparePerfPage` and `runPerfRoute` from `e2e/helpers/perfMeasurement.ts`.
It imports `PERFORMANCE_BUDGETS` and measures `/` and `/tonight` on the private server at `http://127.0.0.1:3228`.
The agent stopped the server and browser after measurement. The agent removed the generated build output.
