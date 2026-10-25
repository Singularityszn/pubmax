# Launch search accuracy preparation

Issue: [#2349](https://github.com/Singularityszn/pubmax/issues/2349).

Base: `21cbdb0666ee0ad02ab170c1f178371160ba4fc8`.
Donor: `43b96f161700491b3f1595e2cde3e201e96843aa`.

This patch reconciles the unshipped AEO work with merged writing PR #2352.
It preserves the current landing layout, imagery, disclosures and introduction.
It also preserves the founder Person and stable organization identifiers already present on main.

## Current reproduction

Ordinary HTTP requests completed on 25 October at 15:46 UTC.
The homepage returned 200 with `X-Vercel-Cache: HIT` and `Age: 194`.
The version endpoint reported the base above and deployment `dpl_A3VaQpWpbFMs16P7y5bpC93fj4Do`.

The completed HTML reproduced these issues:

- The title still described an interactive price map alone.
- The directory publisher was Pint Prices, but the Listed tooltip claimed venue or chain ownership.
- The featured price used `collected` for its source read day.
- The average omitted its cheapest-pint-per-pub population and promised money the reader would keep.

Raw responses are preserved outside the checkout at `/Users/karanmanoharan/.codex/completion/aeo-launch-completion-1025/`.
These requests used no browser JavaScript, account credentials or analytics events.
They do not prove genuine crawler access through the production firewall.

## Prepared changes

| Area | Change |
| --- | --- |
| Price sources | The FAQ names menus and directories. It keeps conditional publisher and date claims. |
| Price answers | The hero labels source read days and missing days. The Listed tooltip no longer asserts venue ownership. |
| Averages | The comparison names each priced pub's cheapest listed pint and describes a sample gap. |
| Product description | Homepage metadata and its share card describe planning with friends. About explains device saves, invites and account features. |
| Structured data | The WebSite description matches visible About copy. Existing IDs, aliases and founder identity remain. |
| Robots | Tests consume Next's emitted robots document for five search bots and retain private-path and preview exclusions. |
| Cached briefs | Today and Tonight show their original preparation time separately from source dates. Cache policy remains unchanged. |
| London clock change | Tests cover midnight, both repeated 01:30 instants and event filtering. |

The publication gates for Pint Index, held area routes and private content remain unchanged.
The patch does not change training permissions or add schema families.

## Validation state

`git diff --check` passed during preparation.
Root admitted focused tests and targeted lint within a 1.5 GiB family allowance.
Each admission required at least 11.75 GiB available by free, inactive and speculative pages.
Full verification, coverage, build, browser and no-mistakes were held at that preparation stage.

Regression tests were prepared before implementation.
The exact base, test patch and reproduction plan are preserved in the external evidence directory.
Nine suites ran against exact base implementation blobs. Eleven assertions failed and 105 passed.
The first integration run found one undefined timestamp reference affecting 57 assertions.
The corrected patch passed 373 tests across 20 suites with one worker.
The final timestamp lifecycle change passed all 66 tests across its two affected suites.
That mounted test proves browser reads retain the page date, while newer server props update it.
Targeted ESLint passed all 31 changed TypeScript files with `--max-warnings=0`.

Logs include `red-focused.log`, `green-focused.log`, `green-focused-retry.log` and `green-server-refresh.log`.
An invalid CLI attempt is separate from the regression evidence.
An admission sequencing error is recorded in `admission-sequence-error.json`.
The failed and successful runs remain preserved.
Those focused runs did not replace repository, browser, no-mistakes or hosted checks.

## Current main reconciliation

The prepared patch merged actual main `a87240e748c859556b3604db508db257af96ca03` without conflicts.
The reconciled head `6c7c55e7975b77fa7b0bf04876daf20c3d27a1d7` passed all 373 focused tests.
Its private production build passed with one build worker.
The local version endpoint reported that exact SHA.

The first Chromium discovery run passed six cases and failed the homepage title assertion.
The emitted title omitted the brand because a layout template does not apply to its own route segment.
The existing browser assertion remains unchanged.
The correction uses an absolute branded homepage title and preserves child-page template behaviour.
Five focused metadata and branding suites passed all 66 tests after this correction.
The failing browser log remains `discovery-browser-current-main.log` in the external evidence directory.
The corrected emitted title passed the unchanged browser assertion in the later runs below.

This local build used fake public authentication configuration and keyless stores.
The authentication-provider endpoint returned 503 in that environment.
These checks do not establish authenticated account acceptance.

## Final local product checks

Actual main advanced to `e5b82b9957bf6b1c3b5511a84da639569e2dc2cc` during validation.
The patch merged it without conflicts at `251ade2f9e7c20ae87d235d2559ed587a10e8bc0`.
The merged Tonight provenance and exclusion changes remain alongside the original page-preparation seed.
Five focused integration suites passed all 101 tests.

Visual inspection found a real preparation-stamp hydration defect.
Node emitted `GMT`, while Chromium emitted `GMT+0` and reported React error 418.
Both new production-browser regressions failed against the retained `40ca511` build.
The fix formats numeric London date parts and derives GMT or BST from that instant's London offset.
It preserves the serialized ISO value and original server preparation time.
Winter, summer, midnight and both DST boundaries have independent expected labels.
The correction passed 78 focused tests and targeted lint before the main integration.

The private production build at `251ade2f9e7c20ae87d235d2559ed587a10e8bc0` passed with one build worker.
The local version endpoint reported that exact SHA.
All 40 Chromium cases passed with one worker across discovery, landing and Day/Home integration.
All five Plan invite cases also passed against that same private production build.
They cover desktop creation, mobile sharing, anonymous guests, private invite boundaries and local RSVP persistence.
Both hydration cases compare actual server text with the hydrated label after a successful theme toggle.
They also reject page errors from Today and Tonight.
The original homepage title, source, account-copy and layout assertions remain unchanged.

The public pages were inspected at 390 by 844 and 1440 by 900 pixels.
The browser used `America/New_York`, while both preparation stamps retained their London labels.
No horizontal overflow appeared in the checked homepage.
Completed HTML without JavaScript, metadata, schema identities, canonicals and sourced hero links passed.
Local robots, llms, sitemap and the public share-card image returned 200.
The non-production robots response blocked all paths, as intended.
The production crawler policy is separately exercised through Next's real robots serializer.

The environment used fake public auth configuration, keyless in-memory stores and empty app-provider credentials.
Authentication-provider reads returned 503 in this fixture environment.
The browser checks do not establish real account, crawler-firewall, physical-device or live-provider acceptance.
No release or real account mutation occurred.
Full verification and the native publication gate remain pending at this record's commit.

External receipts include `browser-hydration-red.log`, `hydration-focused-green.log`, `fresh-main-focused-green.log`,
`build-integrated-green.log`, `browser-integrated-green.log` and `version-integrated-green.json`.
The disposable Plan journey log is `browser-plan-acceptance.log`.
Local screenshots and console evidence remain under `artifacts/playwright-cli/aeo-final/` and `artifacts/playwright-cli/aeo-hydration/`.

The donor's historical report and validation attempts do not validate this reconciled patch.
Authenticated planning and Social journeys remain unverified on this patch.
Real crawler access remains unknown until provider evidence is available.

Rollback requires only a source revert. There are no migrations or data rewrites.
