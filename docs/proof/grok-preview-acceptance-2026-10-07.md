# Grok review preview acceptance, 7 October 2026

This dated record describes the deployment inspection at 16:39 UTC. It does not certify a new application release.

## The live release identity

The public `GET https://pubmaxxing.com/api/version` returned:

```json
{"ok":true,"deploymentId":"dpl_C1QdeoW5TgJucYhv9uca4ZYA2GnX"}
```

Vercel reported that deployment as `READY`, with target `production`, source `cli`, and commit `0c442d44bf97ec14bd240f7b41ef68437cf9627a`. Its metadata names PR #2042. Its aliases include `pubmaxxing.com`.

The later main deployment `dpl_9RgG1n4yRNtY6CrbCan9bLt4fUjK` names commit `3bc62e232be88dcbfa564ecb01970aba68afa9de`. Vercel reported `CANCELED` and linked the ignored-build-step documentation. The deployment events endpoint returned an empty list. The configured ignore command was not present in the connector's project response.

## Preview protection and data isolation

| Inspected target | Actual configuration | Acceptance consequence |
| --- | --- | --- |
| `chengdu`, `prj_FAC09rdCxDiGujUHeDOeZ04JLymc` | Vercel Authentication, password protection, and trusted-IP protection all reported disabled. | A preview in this project cannot be described as protected. |
| `pubmaxx`, `prj_yAw1dFB1Tpb6k2r3Cwx5QqHP0z6z` | Vercel Authentication reported enabled for `all_except_custom_domains`. Its environment inventory was empty. | This target permits a protected keyless preview. It does not permit real account sign-in or provider-backed acceptance by itself. |
| `chengdu` preview variables | Supabase browser and server variables exist with target `preview`. Sensitive values were not decrypted. | Variable names do not prove that the database differs from production. |
| Supabase project inventory | The primary project reported `ACTIVE_HEALTHY`. `pubmax-pentest` reported `INACTIVE`. | No active isolated verification project was established by this inspection. |
| Primary project's branch inventory | The default branch reported `MIGRATIONS_FAILED`. It identifies the parent project itself. | This branch does not establish a separate ready verification database. |

The process environment had no Vercel token, Supabase browser URL, or Supabase service-role key. The inspection did not retrieve credentials or copy environment files.

## The supported deployment path

The [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment) supports a Git source pinned to a commit. Omitting `target` selects a preview. The existing protected `pubmaxx` project is the appropriate target for keyless read-only acceptance.

A Git preview can still stop at the ignored-build step. The [Vercel project settings documentation](https://vercel.com/docs/project-configuration/project-settings#ignore-build-step-on-redeploy) describes a per-deployment redeploy control: uncheck **Use project's Ignore Build Step**. That control does not require a persistent change to the project's ignore command.

The connector's create-deployment arguments do not expose that checkbox. Its `forceNew` argument bypasses deployment deduplication. It does not establish a bypass for the ignore command. Its `projectSettings` argument saves settings for later deployments, so this acceptance lane does not use it to change the ignore command.

## Acceptance still requires these conditions

| Check | Status | Missing condition |
| --- | --- | --- |
| Exact application head on a protected hosted preview | Untested | The application branch must pass its publication gate and reach GitHub. Its exact commit then needs a `READY` preview. |
| Signed-in confirmation | Untested | A ready isolated Supabase database, current schema, its own storage bucket, and a seeded verification account must be available to the preview. |
| Today provider-backed rendering | Untested | A preview needs the relevant read-only provider configuration or an approved isolated data source. The protected project's empty environment does not supply either. |
| External `/workspace` cut-check inputs | Untested | The review's external input files are absent from this checkout. |

The repository's [signable-preview requirements](../DEPLOYMENT.md#a-preview-a-verifier-can-sign-in-to) prohibit test writes to production. Existing preview variable names do not waive that requirement. Local test doubles cannot prove a real hosted sign-in or confirmation.

This lane made no application changes, production writes, migrations, promotions, or project-setting changes. The application fixes and their local browser evidence appear in the [combined reconciliation record](grok-live-reconcile-2026-10-07.md).
