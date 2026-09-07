# Both shells rebuilt, walked and fixed, 7 September 2026

The captain reported on 7 September that the iOS and Android apps "still show
the old version". They do, and nothing was wrong with the code. Both shells are
Capacitor remote-URL wraps (`docs/CAPACITOR_WRAP.md`), so the WEB half updates
itself the moment the site deploys, while every NATIVE change reaches a phone
only when the app is rebuilt and reinstalled. A phone carrying a build from
before PR #1599 never shows that PR's launch screen, safe areas or splash.

## What the captain must run to see the new build on his own phone

**iPhone, plugged in over USB:**

```sh
npx cap sync ios
npx cap open ios     # then pick the iPhone in Xcode's device menu and press Run
```

Xcode needs a signing team set once on the `App` target (Signing &
Capabilities). `npm run ios:run` alone only reaches the simulator; it never
installs to a device.

**Android phone, plugged in over USB with USB debugging on:**

```sh
npm run android:run
```

The script installs to whatever device `adb` can see, emulator or phone.

Both commands load the LIVE site, so the web half is whatever
`https://pubmaxxing.com` is serving at that moment. Only the native chrome comes
from the build.

**A store build waits on accounts, not on code.** Nothing in the repository
blocks a submission. `docs/STORE_READINESS.md` section 8 is the ordered
checklist, and its first three items are the Apple Developer Program enrolment,
the Team ID, and the `support@pubmaxxing.com` mailbox. Until those exist there
is no TestFlight and no Play track, so USB is the only way onto a phone.

## How these shots were taken

A local production build of this branch, served to both rigs, because the
branch's fixes are not on production yet:

```sh
NEXT_DIST_DIR=.next-prod PUBMAX_E2E_KEYLESS=1 npm run build
NEXT_DIST_DIR=.next-prod PUBMAX_E2E_KEYLESS=1 npm run start -- --port 3811 --hostname 0.0.0.0
PUBMAX_NATIVE_SERVER_URL=http://localhost:3811 npm run ios:run
PUBMAX_NATIVE_SERVER_URL=http://10.0.2.2:3811 npm run android:run
```

**These are shots of a local build, not of production.** Rigs: iPhone 17 Pro
simulator on Xcode 26.6, and the API 36 `pubmaxx` emulator. Each launch was
captured on a timer from the moment `simctl launch` / `am start` returned, and
the file name carries the elapsed milliseconds. The interval between shots is
the capture cost itself, roughly 150 to 350ms, so every figure below is the
first frame that showed a thing rather than the instant it appeared.

A keyless build has no Supabase, so Tonight answers "Some listings could not be
checked" with a Retry. That is the honest-failure path working, not a defect.

## What the walk found, and what each shot shows

### iOS, `ios-iphone17pro/`

| Shot | What it shows |
| --- | --- |
| `before-01-landing-painted-2951ms` | A genuine first launch painted the MARKETING LANDING PAGE, hero photograph and all, for a page it was about to throw away. Its top bar is also drawn under the status-bar clock, because the safe-area inset had not resolved on that first frame. |
| `before-02-firstrun-with-consent-card-4403ms` | The landing is replaced at 4403ms, and the analytics consent card is sitting on it. Landing then onboarding is two routes, and reaching a second route is one of the answers `lib/consentAnswerMoment.ts` waits for, so the shell's own rewrite told the card the product had answered. |
| `before-03-compose-clips-the-card` | Taking the card off that screen uncovered a second defect it had been masking: compose stands down while the card is up, so with the card gone the round + parked over the reviewed-area list and cut "PUBMAXX reviewed" to "PUBMAXX revi". |
| `after-01-launch-screen-92ms` | The #1599 ink launch screen, on the build the captain has not seen. |
| `after-02-one-ink-field-2444ms` | One flat `#060607` field, sampled, where a white frame used to stand. |
| `after-03-firstrun-clean-8831ms` | The first launch now opens straight on its destination: no landing, no consent card, no compose, and all three rows read in full. |
| `after-04-warm-coldstart-on-tonight` | Every later launch lands on Tonight with correct safe areas top and bottom. |

Measured on this branch by sampling a fifteen-point grid on every frame:

| Launch | Splash ends | Field between | First content |
| --- | --- | --- | --- |
| First ever (fresh install) | 92ms | ink `#060607`, 905 to 3152ms | 3848ms |
| Every later launch | 288ms | ink `#060607`, 525 to 1621ms | **1888ms** |

The launch that repeats is inside the 2s bar. The first launch is not: it pays
one extra document load, because the shell must open the site root before it can
know where to go. It is still 555ms faster than before the fix, and it no longer
spends that time rendering a page the reader loses.

### Android, `android-api36/`

| Shot | What it shows |
| --- | --- |
| `before-01-firstrun-with-consent-card-4722ms` | The same consent-card defect, reproduced on the emulator. |
| `open-01-white-frame-1649ms` | **Open, not fixed.** A full-frame `#FFFFFF` stands between the ink system splash and the page. The window's own paper bands are painted correctly above and below it, so PR #1599's window background is right and simply does not reach the WebView's rectangle. Two remedies were measured out and are written down in `capacitor.config.ts`. |
| `after-01-firstrun-clean` | The first launch, fixed: no consent card, no compose over the list, safe areas correct top and bottom. |
| `after-02-offline-coldstart` | Airplane mode, cold start. `server.errorPath` serves the bundled outage page: no spinner, no stale price, and a retry. |

Also walked on Android: warm re-entry from the launcher returns to the same
screen, and the back gesture from the first-run surface exits to the launcher,
which is correct because the entry rewrite uses `location.replace` and leaves no
history entry behind it.

## The venue truth contract, re-checked inside the shell

Astra F03, against the origin the shells were actually loading
(`GET /api/venue/venue-p7p18j`, The Three Tuns at the LSE student centre):

```
getIn          {"groupSize":2,"fit":"unknown","label":"Check before going",
                "reason":"We do not hold opening hours for this pub, so we cannot say.",
                "confidence":"unknown"}
busyness       {"isOpen":"unknown","reportCount":0}
contacts       {"phoneNumber":null,"phoneHref":null,
                "websiteHref":"https://www.lsesu.com/social/three-tuns/",
                "emailHref":null,"bookingHref":null}
amenityStatus  every one of eleven keys "unknown"
phone columns on the price rows  {}
```

Phone null, amenities unknown, get-in unknown while the hours are unknown. The
contract holds and nothing was re-implemented. See
`docs/proof/venue-truth-contract/` for the sheet renderings themselves.

## Still open

- **The Android white frame** above. What is left is the frame Android's WebView
  paints while it swaps documents, which the entry rewrite makes every launch
  cross. Holding the system splash until first paint fits the evidence, and it
  is a plugin plus a web-side call rather than a config value.
- **"Use London" sits just below the fold** on the first-run screen on both
  rigs. One short scroll reaches it, and the surface's geometry is fenced by
  `__tests__/nativeFirstRunConsentPlacement.test.ts`, so moving it is its own
  change with its own measurements.
- **The landing page's top bar draws under the status bar on its first frame**
  (`before-01`). The app shell's bars resolve their inset correctly, so this is
  the landing route's own `max(10px, env(safe-area-inset-top))` before the inset
  lands. After this pass the shell never opens on the landing page, so no launch
  crosses it any more.
