# Git preview build proposal

Read-only inspection on 23 October 2026 found:

- Team: `pubmax69`, ID `team_ZHYOvhX8M0Gxyq4J3XOgOwmF`.
- Project: `chengdu`, ID `prj_FAC09rdCxDiGujUHeDOeZ04JLymc`.
- Production branch: `main`.
- Current Ignored Build Step: `exit 0`.
- System environment variables are exposed to the build.

Karan applies this replacement in the project's Ignored Build Step field:

```sh
if [ "$VERCEL_ENV" = "preview" ] &&
   [ "${VERCEL_GIT_COMMIT_REF#codex/preview/}" != "$VERCEL_GIT_COMMIT_REF" ]
then
  exit 1
fi
exit 0
```

The command permits only Preview-target builds from `codex/preview/*` branches.
Production builds remain skipped, including pushes to `main`.
Vercel's exit-code convention is documented in its [project settings reference](https://vercel.com/docs/project-configuration/project-settings).

After Karan applies the setting, push `codex/preview/main-2026-10-23` at
`b58546dfe18ce2834e576e8378bf99cb6c475e04` through the repository's validation path.
Require a Git-sourced READY deployment and a matching `/api/version`.
An explicit ignore-step bypass does not satisfy this check.

For later daily checks, Karan requests one branch at the selected main commit.
Additional preview branches are operator-triggered. There is no scheduler.

The agent did not change this setting or create a production deployment.
