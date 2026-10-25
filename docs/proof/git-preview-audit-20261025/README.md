# Git preview audit, 25 October 2026

Observed around 18:00 GMT through the Vercel deployment API and GitHub API.
This is a dated record, not a statement of the current build policy.

Live `/api/version` and GitHub `main` both returned
`a87240e748c859556b3604db508db257af96ca03`. Its production deployment was
`dpl_6pwPnRjLBFku2Wiqx4f6kAMsDHvo`, in READY state.

The latest ten deployments returned for project `chengdu` contained four READY
Git production builds and six cancelled Git previews. The production builds
named merge commits for PRs #2352, #2354, #2355 and #2353. The preview branches
included writing, auth, native launch, theme and weather work.

## The final writing preview was cancelled

The deployment API returned these fields for PR #2352's final source commit:

| Field | Observed value |
| --- | --- |
| Deployment | `dpl_G3iopTwunCaBzjC3dG8n7sKkPgSp` |
| Commit | `7c7a97a20a1fd0d438cf08f7c7a6db94c0cfc6b1` |
| Branch | `codex/writing-visual-refresh-1023` |
| Source | `git` |
| Target | `null`, a preview |
| State | `CANCELED` |
| Error link | `https://vercel.com/docs/platform/projects#ignored-build-step` |
| Hostname | `chengdu-k7vpapibk-pubmax69.vercel.app` |

GitHub reported the PR's Vercel checks as passed. That result did not mean this
preview built. The subsequent merge commit `20141a0a670181b372fd3b63a6b291c3246d486d`
had a READY production deployment, `dpl_8bShnQFGqpjKse8GYF4Mx9CbNEq6`.

## Remaining acceptance

The battle pack asks for ten consecutive READY Git builds. This audit does not
meet that target. It also cannot provide a successful final-head preview walk
for a deployment that never became READY.

The deployment response identifies the Ignored Build Step as the cancellation
path. It does not expose the exact configured command, so this record makes no
claim about its branch conditions or why the operator selected them.

The captain must decide any build-policy change. The audit changed no Vercel or
GitHub settings, environment variables, Actions, billing or production state.
No artificial pushes were created to satisfy the count.

To refresh this evidence, read the project's deployments, inspect each relevant
deployment by ID, and compare READY versions with the exact GitHub commits.
Keep skipped integration checks and cancelled deployments separate from builds
that ran successfully.
