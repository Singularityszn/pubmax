# Private CLI config package prototype

This prototype removes the bundled Zod implementation from the package entry.
It uses the unchanged published modules with external Zod 4.6.7.
The application does not use this package yet.

The upstream package is `@vercel/cli-config` 0.3.1.
The local version is `0.3.1-pubmax.1`.
The package stays private and has no installation or publication scripts.

`provenance.json` records the official archive integrity and each unchanged file hash.
`LICENSE` preserves the original Apache 2.0 licence.
`NOTICE` identifies the local packaging changes.

The root entry forwards the original 34 exports.
The dedicated `./paths` entry remains separate.
The original bundled `dist/index.js` is absent.
No generated upstream module or declaration was edited.

## Validation status

Focused checks completed on 30 October 2026.
The installed original reproduced three expected failures and passed five other tests.
The prototype passed all 18 tests across three files.
An evidence-only archive passed inspection of its 19 entries and all 14 unchanged upstream files.
The application override, installed graph, typecheck, security audit, full verification, and publication remain unproved.
The retained archive predates these validation-note changes and needs a fresh final package record.
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
