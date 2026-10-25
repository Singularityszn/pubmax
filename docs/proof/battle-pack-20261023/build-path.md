# Build path evidence, 23 October 2026

The task permits preview work only. No setting changed during this inspection.

## Observed state

- Repository: `Singularityszn/pubmax`.
- Project: `chengdu`, `prj_FAC09rdCxDiGujUHeDOeZ04JLymc`.
- Team: `pubmax69`.
- Inspected main commit: `2f18459e18d35507479478d9f4bf3187d524e6d1`.
- Its Git deployment: `dpl_D5GGTERTRmizysL782sBYJKVRfMt`.
- The Vercel deployment API returned `CANCELED` and an Ignored Build Step documentation link.
- A read-only project API request returned `commandForIgnoringBuildStep: "exit 0"`.
- The newest eight deployment records were canceled.

An exit code of zero tells Vercel to cancel the build. This setting explains these cancellations. It does not establish whether the application would build successfully.

Source: [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step).

## Prepared operator change

Karan can select **Only build preview** in **Settings > Build and Deployment > Ignored Build Step**.
The equivalent command is:

```sh
if [ "$VERCEL_ENV" = preview ]; then exit 1; else exit 0; fi
```

A local shell check returned these exit codes:

| VERCEL_ENV | Exit code | Meaning |
| --- | --- | --- |
| preview | 1 | Build |
| production | 0 | Cancel |
| development | 0 | Cancel |
| unset | 0 | Cancel |

This proposal preserves manual production releases. Enabling automatic production builds requires a separate operator decision.
The task did not authorize changing this setting. No change was applied.

## Acceptance still required

1. Karan applies the preview-only setting.
2. A branch push creates a READY preview without a manual skip.
3. `/api/version` names that branch commit.
4. Desktop and mobile checks pass on that preview.

A local build or CLI preview cannot prove that the Git build rule works.
No production promotion, rollback, setting change, environment change, billing change, or Actions change occurred in this work.
