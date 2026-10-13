# Package refresh, 13 October 2026

This dated receipt records a package refresh from `origin/main` at `85512d7bf5c266d6401e7758f1054200429a3f28`.
The work used an isolated checkout with Node `26.10.0` and npm `12.2.0`.

All five open pull requests were checked for ownership of the four package manifests and lockfiles.
None changed those files, and the primary checkout had no uncommitted manifest changes.
No primary or global package installation was changed.

## Versions

The npm registry was checked again before mutation.
Root ranges retain their existing caret policy except the exact MapLibre pin.
Nested direct dependencies remain exact pins.

| Scope | Package | Previous locked version | Refreshed locked version |
| --- | --- | --- | --- |
| Root | `@ai-sdk/otel` | `1.0.137` | `1.0.138` |
| Root | `ai` | `7.0.137` | `7.0.138` |
| Root | `@radix-ui/react-slot` | `1.4.0` | `1.5.0` |
| Root | `@typescript-eslint/parser` | `8.71.1` | `8.71.2` |
| Root | `vitest` | `5.0.3` | `5.0.4` |
| Root | `@vitest/browser-playwright` | `5.0.3` | `5.0.4` |
| Root | `@vitest/coverage-v8` | `5.0.3` | `5.0.4` |
| Root | `effect` | `4.0.2` | `4.0.4` |
| Root | `lucide-react` | `1.55.0` | `1.56.0` |
| Root | `posthog-js` | `1.438.7` | `1.438.9` |
| Root | `maplibre-gl` | `6.13.0` | `6.14.0` |
| Root override | `postcss` | `8.5.29` | `8.5.30` |
| ChatGPT map | `postcss` | `8.5.29` | `8.5.30` |
| ChatGPT map | `zod` | `4.6.5` | `4.6.7` |

The root PostCSS override changes from `^8.5.28` to `^8.5.30`.
The nested MCP SDK remains at its existing `1.32.1` manifest and lockfile version.
A fresh nested install now supplies that version in this worktree.

## Pin decisions

MapLibre remains an exact pin, advanced to `6.14.0`.
Its [official release notes](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.14.0) include fixes for terrain camera jumps, reduced-motion movement and failed-tile events.
They also include fixes for WebGL context loss and affected iPadOS Safari devices.
The existing v6 imports and explicit worker configuration remain unchanged.
Both copied worker modules match the installed `6.14.0` files byte-for-byte.
Browser, native and performance acceptance still require separate evidence.

The exact `typescript` pin stays at `6.0.3`.
The refreshed parser's published peer range is `>=4.8.4 <6.1.0`, consistent with its [official compatibility guidance](https://typescript-eslint.io/users/dependency-versions/).
The installed Next.js guide also states that TypeScript 7 lacks the JavaScript compiler API used when `experimental.useTypeScriptCli` is false.
This project deliberately uses that setting, documented in `next.config.mjs` and `docs/CI_RUNBOOK.md`.
The existing `@typescript/native` alias remains `npm:typescript@^7.0.2`, locked at `7.0.2`, for the native CLI check.
No compiler mode, performance ceiling or runtime budget changed.

## Commands and policy

Official `npm pkg set` and `npm install --package-lock-only` commands changed manifests and regenerated both lockfiles.
Each worktree dependency tree was then installed with `npm ci --ignore-scripts --no-audit --no-fund`.
The existing allowlist command rebuilt only the approved `esbuild` packages.
Both `allowScripts` objects remain identical to their original values.
The `.npmrc` policy and allowlist reasons remain unchanged.

## Validation

| Check | Result |
| --- | --- |
| Fresh root and nested `npm ci` | Passed |
| Install-script allowlist check and approved rebuilds | Passed |
| Root and nested installed-tree freshness | Passed |
| Root and nested `npm ls --depth=0` | Passed |
| `npm run typecheck` with native TypeScript 7 | Passed |
| TypeScript 6 bridge `tsc --noEmit` | Passed |
| `npm run lint` | Exit 0, no errors, 17 warnings |
| Five focused Vitest files | 61 tests passed |
| Nested ChatGPT map tests | 8 tests passed |
| Worker asset byte comparison | Passed |
| `git diff --check` | Passed |

The focused tests were `nodeModulesFresh`, `ciRunnerIsolation`, `qualityGateWiring`, `qualityGateScripts` and `maplibreCodeSplit`.
Lint warnings concern three unused `_response` parameters in `whatsOnTonightRolloverRace.test.ts` and 14 complexity warnings on unchanged source.
No warning rule or threshold was weakened.

The final root `npm outdated` reports only the retained TypeScript 6 bridge pin.
The nested `npm outdated` reports no newer direct dependency versions.

The full `npm run verify` gate, production build, browser regressions, native proof and performance acceptance were not run.
Those checks remain required before merge or release.
