# Signed simulator startup comparison

8 September 2026. Startup proof only. First-run onboarding is not accepted.

Native source: `d55f6e16c0b4eceddb514bc9311e5de476c2b7bd`.
The existing onboarding CSS changes were not part of the native compilation.
Capacitor CLI regenerated manifests from the same dependencies for both builds.
The generated package manifest and resolved dependencies matched the retained original build records.

Dependencies: Capacitor core/iOS 8.5.1, camera plugin 8.2.4, IONCameraLib 2.0.0.
Exact remote revisions are in `built-Package.resolved.json`.
The generated package graph is in `built-Package.swift.txt`.

Original App SHA-256: `bb56875a3bf6b92241ed000317eb72b1530aa547fe1f3966025811b2c3fab67f`.
Normal-sign App SHA-256: `b0cf61054250e89ba472c0231a80e585ecf0bdac26c118d6d89d0a8f929819ca`.
Both retained artifacts use `http://localhost:3811`, with cleartext enabled and `offline.html` as the error page.
The artifacts remain under `ios/build` and `ios/build-normal-sign`, respectively.

## Controlled build

The original command used `CODE_SIGNING_ALLOWED=NO`.
The comparison removed that override, without manual signing or loader changes.
It used a separate derived-data directory and the existing package cache:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build-normal-sign -clonedSourcePackagesDirPath ios/build/SourcePackages -skipPackageUpdates -jobs 4 build
```

All normal-sign ARM64 bundle and embedded-framework signature checks passed before launch.
The original bundle checks failed. Exact results are in `signed-startup-verification.json`.
Build output is in `normal-sign-build.txt`.

## Served web identity

The server used the preserved `.next-audit-final-e2e` production artifact on port 3811.
The observed `/api/version` reported `3e9f77ef56bf0aaac56d2bf9ecfa999d728fded8`.
Its build time was `2026-09-08T03:59:23.444Z`.
Inherited model and durable-service credentials were blanked. No account operation occurred.
Native source and served web source are different identities.

## Observation

Both launches used the owned iOS 26.5 simulator `15BB7F4A-B86D-465B-B0D3-D2282924335E`.
This device was reused. No storage reset established a fresh installation.

The original process 47493 stayed at splash.
Its dyld log ended at the host build directory's IONCameraLib image.
Its sample remained in `__open`, before application code, with a 480 KB footprint.
See `dyld-0441-*`.

The normal-sign process 90644 rendered the actual site in the native app.
CUA captures show the root landing page and native navigation tabs.
It did not show onboarding in the observed interval.
See `signed-build-first.png`, `signed-build-settled.png`, and `signed-build-*` logs.

This comparison establishes startup recovery for the normally signed build.
It does not prove which individual signature or loader operation caused the earlier stall.
It does not establish first-run routing, onboarding, permission behavior, or physical-device acceptance.

Diagnostic launch variables were `SIMCTL_CHILD_DYLD_PRINT_SEARCHING=1`,
`SIMCTL_CHILD_DYLD_PRINT_LIBRARIES=1`, and `SIMCTL_CHILD_DYLD_PRINT_INITIALIZERS=1`.
`simctl launch --stdout=<proof path> --stderr=<proof path>` captured output.
No environment dump, library-path override, manual deep signing, or RPATH edit occurred.

Owned server and simulator stopped after capture. Runtime was explicitly released.
Generated working manifests were restored. The temporary dependency symlink was removed.
Other simulators and the original artifact remain unchanged.

## Next bounded check

Use a new disposable iPhone 17 Pro on installed iOS 26.5.
Install the retained normal-sign artifact, without copying any app data.
Verify the same web identity on port 3811 before normal root launch.
Capture actual first entry at 15 and 30 seconds.
If onboarding appears, capture London and companion actions before scrolling.
Use visible controls only. Do not sign in, grant permissions, or reset eligibility markers.
Stop the owned server, shut down and delete only the new device, and release within three minutes.

## Tracked command finding

`scripts/ios-simulator.mjs:153` still supplies `CODE_SIGNING_ALLOWED=NO`.
This exists in both the native source checkout and the current audit checkout.
No script change belongs to this proof-only commit.
