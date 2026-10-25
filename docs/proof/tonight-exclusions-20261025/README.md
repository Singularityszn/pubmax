# Tonight source exclusions, 25 October 2026

Before: signed-out production at `a87240e748c859556b3604db508db257af96ca03`.
After: local development server on port 3463 at
`761ba9041`, with no production credentials. Chromium used desktop 1440×1000
and mobile 390×844 viewports. These are browser viewports, not physical devices.
All browser non-GET requests were blocked before navigation.

The source bundle carries Cask's 25 October music listing with a 7 October source
check. The 24-hour freshness rule excludes that listing in both versions.
The changed page says why the listing is hidden. It no longer describes that
old recorded check as an absent check. Feed-specific missing-date messages
remain available when no exclusion explanation supplies the reason.

| Before | After, desktop | After, mobile |
| --- | --- | --- |
| ![Before](before-desktop.png) | ![After desktop](after-desktop.png) | ![After mobile](after-mobile.png) |

The local environment has no configured live listings provider. Its provider
availability message differs from production. The source exclusion and its
visible explanation are the comparison under test.

The targeted Vitest run passed 103 tests across `tonightFreshnessExplanation`,
`tonightOutListings`, `tonightPubSurface` and `voiceComplianceAudit`.
Two additional rendered assertions failed before the stale-versus-missing
correction and passed after it. Changed-file ESLint and `git diff --check` passed.
Production-build validation and hosted checks are reported separately by the PR.
