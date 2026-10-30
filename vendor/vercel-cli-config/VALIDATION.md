# Validation status and planned integration

The following dated results cover `0.3.1-pubmax.1` on 30 October 2026.
The original package reproduced three expected failures and passed five other tests.
The prototype passed all 18 initial tests through normal npm test setup.
The installed `.1` archive had 19 entries and SHA-256 `79307fbce8bae7c49ec30b2cf424b891d062419bb9c31449b1bc9797832c0aa6`.
All entries matched the verified source, all 14 upstream hashes matched, and the bundled entry was absent.
A fresh local npm installation passed 36 tests across four files.
Direct OIDC resolution and external root Zod resolution passed.
The public TypeScript consumer passed, including both negative type cases.
The existing npm audit received a real report with no high or critical findings.
Its unavailable branch did not supply that result.
This npm result is not OSV or complete security proof.

The coordinator independently confirmed release of the recorded process groups.
Finite sampling leaves true peak memory and unrecorded descendants unknown.
The original preparation base is `9b593b884729a11f3df02e788b16f153fdc27b21`.
The installed validation followed the local Main merge at `bfbe346b4d00e281ed370b90fd7bd0ea569d76fb`.
The current source version is `0.3.1-pubmax.2`.
That final source does not claim an existing `.2` archive or installation.
Each final artifact needs its own integrity record, lockfile, installation, and remaining acceptance.
The original candidate and the `.1` archive remain preserved.
The coordinator must allocate the next runtime before any command below runs.

## Agreed public interfaces

The coordinator selected package resolution, API compatibility, types and credential privacy.
The tests use these public interfaces.
They do not inspect implementation strings or use live credentials.

| Contract | Independent oracle | Wrong behaviour rejected |
| --- | --- | --- |
| Root exports and native ESM | The published 0.3.1 API exposes 34 names. | Missing exports, new private exports, or missing native named imports. |
| Dedicated paths entry | The published package exports `./paths`. | Package export resolution fails or returns a different auth-file path. |
| External runtime dependency | The replacement must load the application Zod 4.6.7 module. | The public package entry still runs the bundled implementation. |
| Package-owned collection parsing | Upstream fix `a0ebf97` rejects oversized collections before their elements. | A package-owned auth schema still runs element refinements before checking its array bound. |
| Schema behaviour | Auth and global config retain unknown fields. Auth-file parsing removes `tokenSource`. | Dropped fields, invalid scalar acceptance or leaked transport-only metadata. |
| Credential files | Explicit auth writes use mode 0600. `skipWrite` preserves existing bytes. | Public permissions or replacement of a file when writing is disabled. |
| Storage selection | Auto storage uses a supplied fixture file when token data exists. | Wrong storage choice or acceptance of an invalid storage setting. |
| Type consumers | Public token types accept strings. Storage has three allowed values. | Numeric tokens, new storage values or incompatible generic schema output. |

The expected baseline failures are the runtime dependency and package-owned collection tests in installed mode.
The published bundled entry has no external Zod child in its loaded module graph.
The prototype should load that external module through its unchanged schema modules.
The collection tests start from the package's exported auth schema.
They create three synthetic values and a limit of two.
They require zero element refinements before size rejection.
They also require two refinements for a permitted collection and reject invalid token types.
An unused external Zod import cannot satisfy these behaviour checks.
The recorded baseline reproduced only the three expected contract failures.
The prototype passed those contracts and the remaining selected tests.
The public TypeScript consumer passed for the installed `.1` package.
That isolated consumer check does not replace the full application typecheck.

## Future npm 12 sequence

Use the repository-supported Node version and npm 12.2.1.
Confirm the source hashes and the runtime allocation first.
The completed baseline and prototype phases used normal `npm test` with the config and setup unchanged.
The commands below identify those selected contracts.
Their completed results remain recorded without another run.

```sh
PUBMAX_CLI_CONFIG_SUBJECT=installed node_modules/.bin/vitest run __tests__/vercelCliConfigPackaging.test.ts --maxWorkers=1
node_modules/.bin/vitest run __tests__/vercelCliConfigPackaging.test.ts __tests__/vercelCliConfigLintPolicy.test.ts __tests__/zodSecurity.test.ts --maxWorkers=1
```

The worktree has its own lockfile installation from the allocated setup phase.
The local `.1` installation used an explicit root archive dependency and a version-scoped reference.
The final `.2` source declares the same shape with its new archive filename.

A final `.2` archive still needs an allocated package phase.
The retained `.1` archive does not identify the new version and documentation.
The final `.2` integration sequence below remains unexecuted.
Apply the override only after the coordinator accepts the prototype evidence.
The bracket notation preserves the periods in the parent package version.
The source declarations retain unrelated overrides.
The parent-only `file:` shape failed because npm resolved it under the parent package.
The explicit root dependency and scoped reference completed lock generation and fresh installation for `.1`.

```sh
npm pack ./vendor/vercel-cli-config --ignore-scripts --pack-destination ./vendor
npm pkg set 'dependencies[@vercel/cli-config]=file:vendor/vercel-cli-config-0.3.1-pubmax.2.tgz'
npm pkg set 'overrides[@vercel/oidc@4.0.1][@vercel/cli-config]=$@vercel/cli-config'
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --no-audit --no-fund
PUBMAX_CLI_CONFIG_SUBJECT=installed node_modules/.bin/vitest run __tests__/vercelCliConfigPackaging.test.ts __tests__/vercelCliConfigLintPolicy.test.ts __tests__/zodSecurity.test.ts __tests__/searchProvider.test.ts --maxWorkers=1
```

The `.1` archive, explicit root dependency, scoped reference, lock generation, and fresh installation completed their focused checks.
Those historical results do not establish final `.2` acceptance.
If npm refuses the scoped local archive, preserve its exact diagnostic.
Do not replace the scope with a global override or edit the lockfile manually.
Do not use a post-install patch or a deep import into an unexported package path.

After the override resolves, inspect the npm graph and packed archive integrity.
Confirm direct OIDC stays 4.0.1 and the existing nested SDK OIDC stays unchanged.
Run the canonical typecheck, lint and configured no-mistakes checks under the allocated slot.
Keep every existing browser, privacy and provider requirement.
The unchanged selector lists `eslint.config.mjs` as a shared foundation.
This candidate therefore requires the configured full verification when that selector runs.
Do not change the selector or add a duplicate manual full run.

The lint configuration excludes the thirteen exact copied module and declaration paths.
Each excluded file remains byte-identical to the official archive.
The integrity manifest records its original hash.
The exclusion does not cover the directory or future files.
The new entry and regression tests retain normal lint rules.
The package metadata and validation documents receive no additional exclusion.
The CommonJS entry has no inline rule exemption.
Its file-specific policy keeps `no-require-imports` at error.
Only its four exact local upstream module imports are allowed.
This preserves the synchronous CommonJS API without a compiler or a runtime loader workaround.
The five lint-policy tests passed through the real ESLint configuration and lint APIs.
They check the generated-file scope, four allowed imports, refused imports and the empty-block rule.
The canonical lint command remains unrun for this candidate.

Package resolution, source provenance and security acceptance are separate checks.
The existing five application Zod collection-limit cases remain unchanged.
Their success alone does not prove that this package stopped using a bundle.
The runtime dependency test observes the actual loaded package graph.
The package-owned collection tests check the parser reached through the public schema.

## Limits and removal

The `.1` focused tests, fresh installation, public type consumer, and npm audit passed.
The installed original had exactly the expected baseline failures.
Full application types, OSV, configured full verification, builds, and product acceptance remain final requirements.
No public merge, upstream publication, or deployment follows from these results.
The `.2` source preparation changes no lockfile or installed dependencies.
The `.1` working archive remains preserved outside the checkout.

The local package changes the packaging only.
It is not an official Vercel release.
Its final archive and installed graph need the remaining acceptance before release.
Remove it after a compatible official package passes the same artifact and public-interface checks.
