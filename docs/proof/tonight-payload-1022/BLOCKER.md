# Tonight payload overlap blocker, 22 October 2026

The payload fix needs captain direction before it can change Tonight's page.
Two open pull requests change the files involved in this task.
The repository workflow requires a stop when changed files overlap.

## Rule and current evidence

[`docs/agents/build-methodology.md`](../../agents/build-methodology.md), under "Multi-agent rules", says:

> Scope check before starting. Skim open PRs' changed files (`gh pr list`, `gh pr diff <n> --name-only`) and look for uncommitted work in shared checkouts. On overlap, stop and ask for direction.

The following pull requests were open during this iteration.

| Pull request | Head commit | Overlapping files |
| --- | --- | --- |
| [#2320](https://github.com/Singularityszn/pubmax/pull/2320) | `54b295851cc9728692c104b1313c3daadafc480f` | `app/tonight/page.tsx` |
| [#2321](https://github.com/Singularityszn/pubmax/pull/2321) | `f6567dda5fab3f2cece4d8bc9367c1925e8cba80` | `app/tonight/TonightClient.tsx`, `lib/tonightOutListings.ts`, `__tests__/tonightServerListings.test.tsx` |

PR #2320 changes the page metadata. Its patch does not change the listing composition.
This is a workflow stop because the files overlap. It is not a demonstrated Git merge conflict.
The captain can allow a separate focused change, or wait for those pull requests to merge.
The captain received that question through the text-input tool. No answer had arrived when this record was written.

The task's no-mistakes override permits a direct push after verification.
It does not explicitly waive the overlap rule.

The scope check used these read-only commands:

```sh
gh-axi pr list --state open --limit 40
gh-axi api /repos/Singularityszn/pubmax/pulls/2320/files --paginate
gh-axi api /repos/Singularityszn/pubmax/pulls/2321/files --paginate
gh-axi api /repos/Singularityszn/pubmax/pulls/2320
gh-axi api /repos/Singularityszn/pubmax/pulls/2321
```

The other six open pull requests did not name the proposed implementation files.
The checkout remained on `codex/tonight-payload-1022` at `44c9d06f094926f2c7d14be3bf54382dfdb4538e`.

## Reviewable candidate

[`candidate.patch`](candidate.patch) contains a proposed implementation and seven regression tests.
The patch applies to this checkout. The application does not use it yet.
This iteration leaves no application or test source changes.

The candidate applies the existing pub eligibility filter before serializing the Out events.
It preserves eligible events in their original order, together with one unmatched event.
Tonight's existing client uses that unmatched event to show its unmatched-listings notice.
Removing every unmatched event would change the visible page.
The candidate leaves status, source dates, provider reports, and open-plan fields unchanged.
It does not change browser revalidation, map links, or the full map venue ID list.

The source also shows that `TonightOpenPlans` reads `liveOut.body`, rather than the initial server answer.
The candidate retains the initial open-plan fields anyway. Removing those fields needs separate proof.

The retained production capture from iteration 1 gives these candidate figures:

| Out answer | Before | Candidate |
| --- | ---: | ---: |
| Event rows | 78 | 2 |
| JSON bytes | 44,461 | 1,785 |

The candidate removes 42,676 JSON bytes from this captured answer.
One retained row is the eligible pub event. The other supports the existing unmatched-listings notice.
[`candidate-measurement.json`](candidate-measurement.json) records the figures and retained row IDs.
These figures measure a projection of a historical capture. They do not measure a new HTML document or deployment.

## Validation and remaining work

`npm ci` passed. It reported five high-severity vulnerabilities, as the previous iteration also recorded.
The candidate regression first failed because the serialized answer retained five fixture rows instead of two.
After the candidate change, all seven candidate tests passed.
The existing server-rendered page was identical before and after trimming across ready, empty, and failed listing reads.

These checks passed while the draft files were present:

```sh
npx vitest run __tests__/tonightInitialOutAnswer.test.tsx __tests__/tonightServerListings.test.tsx __tests__/tonightOutListings.test.ts __tests__/tonightPubSurface.test.ts
# 4 files passed, 78 tests passed.

npx eslint app/tonight/initialOutAnswer.ts __tests__/tonightInitialOutAnswer.test.tsx
# Exit 0.
```

The page integration in the patch has not run. Full verification and layout checks remain outstanding.
This iteration ran no build, server, deployment, migration, push, or PR creation.
No performance ceiling changed. No background process started by this iteration remains running.

If the captain permits overlap, the next iteration can take these steps:

1. Refresh both pull requests and preserve their changes.
2. Apply and review the candidate patch.
3. Measure the built document with `NEXT_DIST_DIR=.next-tonight-payload-1022` and the repository performance helper.
4. Run the Tonight layout checks and `npm run verify`.
5. After the orchestrator commits the result, verify its head, push the branch, and open the PR under the captain's override.
