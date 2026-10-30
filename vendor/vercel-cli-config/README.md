# Private CLI config package prototype

This prototype removes the bundled Zod implementation from the package entry.
It uses the unchanged published modules with external Zod 4.6.7.
A local installation of `0.3.1-pubmax.1` completed the focused checks below.
The current source version has no claimed production release.

The upstream package is `@vercel/cli-config` 0.3.1.
The current source version is `0.3.1-pubmax.2`.
The package stays private and has no installation or publication scripts.

`provenance.json` records the official archive integrity and each unchanged file hash.
`LICENSE` preserves the original Apache 2.0 licence.
`NOTICE` identifies the local packaging changes.

The root entry forwards the original 34 exports.
The dedicated `./paths` entry remains separate.
The original bundled `dist/index.js` is absent.
No generated upstream module or declaration was edited.

## Validation status

Validation recorded on 30 October 2026 covers `0.3.1-pubmax.1`.
The original package reproduced three expected failures and passed five other tests.
The prototype passed all 18 initial tests.
A fresh local installation matched all 19 verified archive files and passed 36 tests across four files.
The public TypeScript consumer passed both negative type cases.
The existing npm audit received a real report with no high or critical findings.
That audit is not OSV or complete security proof.

The installed results identify the `.1` archive in `validation.installedPackage` within `provenance.json`.
Version `.2` changes documentation and package identity.
Final acceptance requires its own verified archive, npm-generated lockfile, fresh installation, and required integration checks.
Full application types, configured verification, browser acceptance, and publication remain required.
Finite process observations do not prove true peak memory or all descendants.

The regression suite uses public config operations and synthetic credential files.
It checks CommonJS exports, native Node ESM access, external module resolution,
auth-file permissions, `skipWrite`, token-storage decisions and unknown-field preservation.
It also checks early collection refusal through the package's exported auth schema.
The type fixture checks the original public declarations.
The lint policy names only thirteen byte-identical upstream artifact paths.
The new entry, tests and future files retain normal lint rules.
The authored CommonJS entry permits only its four fixed local imports.
The import rule stays at error, and the entry has no inline exemption.
The prepared policy tests use the real ESLint configuration and lint APIs.

## Removal

Remove this package when an official compatible release uses patched Zod
without retaining the affected implementation in its bundle.
Verify the published artifact and the application journeys before removal.
Then regenerate the application lockfile through npm.
Keep the package contract tests against the selected official package.
