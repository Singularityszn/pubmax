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
Full verification, coverage, build, browser and no-mistakes remain held.

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
Required repository, browser, no-mistakes and hosted checks remain pending.

The donor's historical report and validation attempts do not validate this reconciled patch.
Authenticated planning and Social journeys remain unverified on this patch.
Real crawler access remains unknown until provider evidence is available.

Rollback requires only a source revert. There are no migrations or data rewrites.
