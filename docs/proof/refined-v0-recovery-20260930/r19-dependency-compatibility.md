# R19 dependency compatibility receipt

Source and read-only registry inspection only. No installs, compiler execution, build or tests in this phase. Earlier current R18 gates cover the installed candidate, not any upgrade proposed here.

All 70 installed direct packages match the committed lockfile. All 70 `latest` metadata requests to the official npm registry succeeded. At this observation, 67 match `latest`; differences are `ai` 7.0.122 to 7.0.123, `@ai-sdk/otel` 1.0.122 to 1.0.123, and TypeScript 5.9.3 to 7.0.2. The first two are patch candidates; API compatibility and new final gates still need validation. No lockfile was hand-edited.

Registry timestamp: 2026-09-30T07:49:52.126636+00:00. Full versions, engines and URLs are retained in `r19-dependency-registry-inventory.json`; installed/locked comparison is in `r19-dependency-installed-inventory.json`.

TypeScript 7 is not a drop-in upgrade for the current full toolchain. Official metadata exports its root as `lib/version.cjs` and exposes new unstable AST APIs. Own `scripts/assert-no-conditional-e2e-skips.mjs:5,90,170` imports the old default compiler namespace and calls ScriptKind/createSourceFile/isCallExpression. Installed `@typescript-eslint/parser` and `typescript-estree` 8.71.0 require TypeScript `>=4.8.4 <6.1.0`, excluding 7. This is a concrete declared compatibility gap; no actual TS7 install or failing execution is claimed.

Installed Next.js 16.3.7 DOES support TypeScript 7 through its project-local CLI checker. Its local guide `node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md:16-41` documents this and says the CLI path is default. `verify-typescript-setup.js:210-228` selects the CLI or old compiler API; `runTypeScriptCli.js:104-111` handles the native process wrapper. Next.js is therefore not a blanket blocker. Using `ignoreBuildErrors`, disabling the skip gate, forcing incompatible peer dependencies or raising lint ceilings would not solve the toolchain contract.

Next action: keep the measured R18 build unchanged for native performance attribution, then regenerate the lockfile for compatible patch candidates and run real generation, AI-route/telemetry regressions plus final source/build/browser gates. Assess TS7 migration through supported parser and skip-gate APIs in an isolated owner lane before changing the validated compiler. Preserve current typechecking and structural skip detection. Source inspection does not prove the future compiler works.

Sources: [official TypeScript latest metadata](https://registry.npmjs.org/typescript/latest), [Next.js latest metadata](https://registry.npmjs.org/next/latest), installed package peer declarations, and the local Next.js guide. Runtime compatibility remains unverified.
