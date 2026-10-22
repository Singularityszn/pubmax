# Package and skill refresh, 21 October 2026

This record describes the dependency refresh from `542c97545`. It does not establish deployment or physical-device acceptance.

## Package changes

| Package | Before | After |
| --- | --- | --- |
| `@ai-sdk/otel` | `^1.0.138` | `^1.0.148` |
| `@capacitor/camera` | `^8.2.5` | `^8.2.6` |
| `@clerk/nextjs` | `^7.9.14` | `^7.9.19` |
| `@elevenlabs/react` | `^1.17.0` | `^1.19.0` |
| `@remotion/player` | `4.0.536` | `4.0.537` |
| `@supabase/supabase-js` | `^2.117.3` | `^2.118.0` |
| `@typesafe-ai/sdk` | `^0.6.0` | `^0.7.0` |
| `@vercel/oidc` | `4.0.0` | `4.0.2` |
| `ai` | `^7.0.138` | `^7.0.148` |
| `context.dev` | `3.5.0` | `3.14.0` |
| `convex` | `^1.46.0` | `^1.47.0` |
| `effect` | `^4.0.4` | `^4.0.5` |
| `lucide-react` | `^1.56.0` | `^1.61.0` |
| `maplibre-gl` | `6.14.0` | `6.15.0` |
| `next` | `^16.4.0` | `^16.4.2` |
| `openai` | `^7.32.0` | `^7.41.0` |
| `posthog-js` | `^1.438.9` | `^1.438.13` |
| `react` | `^19.3.0` | `^19.3.1` |
| `react-dom` | `^19.3.0` | `^19.3.1` |
| `remotion` | `4.0.536` | `4.0.537` |
| `@axe-core/playwright` | `^4.13.0` | `^4.14.0` |
| `@copilotkit/aimock` | `^1.45.1` | `^1.46.0` |
| `@elevenlabs/client` | `1.27.0` | `1.29.0` |
| `@next/env` | `^16.4.0` | `^16.4.2` |
| `@playwright/test` | `^1.64.0` | `^1.64.1` |
| `@typescript-eslint/parser` | `^8.71.2` | `^8.72.0` |
| `@vitest/browser-playwright` | `^5.0.4` | `^5.0.5` |
| `@vitest/coverage-v8` | `^5.0.4` | `^5.0.5` |
| `eslint` | `^10.12.0` | `^10.13.0` |
| `eslint-config-next` | `^16.4.0` | `^16.4.2` |
| `jsdom` | `^30.1.2` | `^30.1.3` |
| `knip` | `^6.41.0` | `^6.42.1` |
| `vitest` | `^5.0.4` | `^5.0.5` |
| `override:uuid` | `14.0.2` | `14.0.3` |
| `override:browserslist` | `^4.29.3` | `^4.29.4` |
| `override:playwright` | `1.64.0` | `1.64.1` |
| `override:playwright-core` | `1.64.0` | `1.64.1` |
| `override:postcss` | `^8.5.30` | `^8.5.31` |

`scripts/chatgpt-map` updates PostCSS from 8.5.30 to 8.5.31. The package manager regenerated both npm lockfiles. Install-script permissions remain unchanged.

## Compatibility limits

- TypeScript stays at 6.0.3 because the current TypeScript ESLint parser requires TypeScript below 6.1. The separate native typechecker remains at 7.0.2.
- OpenTelemetry API stays at 1.9.1 because the current tracing SDK requires a version below 1.10. The package range now permits only 1.9 patches.
- The OTLP exporter stays at 0.223.0. Version 0.300.0 uses tracing SDK 3, while the current Vercel integration requires SDK 2.
- Capacitor stays on stable version 8.5.3. Android stays on compile and target SDK 36. AndroidX Core 1.19 requires SDK 37 and AGP 9.1, so this update uses Core 1.18.
- The existing development-only braces advisory has no patched release. The production dependency audit reports zero vulnerabilities. The existing scoped waiver remains unchanged.

## Android updates

The Android build keeps the Capacitor 8 toolchain boundary. AGP updates from 8.13.0 to 8.13.2, Google Services from 4.4.4 to 4.5.0, and Gradle from 8.14.3 to 8.14.6.

AndroidX Activity updates to 1.13.0, AppCompat to 1.8.0, Core to 1.18.0, Fragment to 1.9.1, and WebKit to 1.18.0. Their published AAR metadata accepts compile SDK 36. The remaining AndroidX and test libraries already match their stable releases.

## SDK adaptations

The Context.dev batch request now uses `formats: { markdown: true }`. The new HTTP boundary test rejects the previous payload with HTTP 400 and accepts the updated payload.

TypeSafe request parameters exclude null states as required by SDK 0.7. Batched price questions retain their choice-or-noul types, so their answer types exclude unrelated box answers.

## Skills

The refresh updates 19 project skill trees from their upstream sources. The merge preserves local restrictions. Review also updated the new debugging references to require Debug builds and prohibit committed temporary network exceptions. The installed skill names remain unchanged. The `.agents/skills/SOURCES.md` file records source commits and retained retired skills.

Validation checks 89 unique discoverable names, valid YAML metadata, and relative links in changed Markdown.

## Validation

- The 174 focused SDK tests pass. The new batch regression failed before the payload change and passes after it.
- The main suite passes 42,433 tests across 2,071 files, with one existing skipped test.
- TypeScript checking passes.
- Capacitor sync passes for iOS and Android.
- The database suites pass 679 tests. The PostgreSQL harness suite passes 10 tests.
- Android debug compilation and JVM unit tests pass with Gradle 8.14.6.
- The iOS simulator build passes.
- The complete verification command stops at `check:freshness`: `famous_venues` is 405.6 hours old against a 384-hour budget. The local runtime has no Google Places key for the supported refresh command. This update changes no data dates or freshness budgets.
- The post-freshness install-script and audit checks pass.
- The production build passes with Next.js 16.4.2. All eight core route smoke tests pass in Chromium against that completed build.
- Two independent reviews found one documentation conflict. The updated references passed review. No actionable findings remain.

The full verification result remains blocked by the stale dataset. The branch remains local without a push, pull request, merge, or deployment.

## Separate maintenance update, 22 October 2026

The original integration owner took the nine web package files for the combined Pub Pal candidate. Its later dataset refresh passed all 22 dataset checks and the freshness check.

The separate `codex/skills-native-refresh-1022` branch contains 117 skill files, three Android files, and this record. Git comparison confirmed that the skill and Android files match the reviewed refresh at `9a5631bd61552e87e12f0445603a5d87805e7956`. The original branch remains at that commit.

This branch starts from `542c97545fc00c4c13a5afb5848e8099be0195e0`. It requires rebase and final verification after the combined candidate merges. The earlier test results describe the original combined package update. No test, merge, or deployment result is claimed for this separate branch.
