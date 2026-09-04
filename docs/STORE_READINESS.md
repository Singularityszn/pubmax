# PUBMAXX Store Readiness Pack

**Status:** Everything on this page is pre-writable now, without an Apple or Google developer account. It is the copy, metadata, and answer sheet the owner pastes into App Store Connect and the Google Play Console once enrolment clears. Paid-account work includes enrolment, certificates, Sign in with Apple activation, and the first binary upload, listed as the owner checklist in the last section.

**App:** PUBMAXXING. London pub finder, crawl planner, and night log, wrapped in a Capacitor shell over `https://pubmaxxing.com` (see `docs/IOS_APP_PRD.md`, `docs/CAPACITOR_WRAP.md`).

**Identity (already fixed in the repo, do not change):**

| Field | Value | Source |
| --- | --- | --- |
| App name | PUBMAXXING | `capacitor.config.ts` `appName`; iOS `CFBundleDisplayName`; Android `app_name` |
| iOS bundle id | `com.pubmaxx.app` | `capacitor.config.ts` `appId` |
| Android applicationId | `com.pubmaxx.app` | `android/app/build.gradle` (same string, iOS convention) |
| Version name | 1.0 | `android/app/build.gradle` `versionName`; iOS `MARKETING_VERSION` |
| Version code / build | 1 | `android/app/build.gradle` `versionCode`; iOS `CURRENT_PROJECT_VERSION` |
| Category | Food & Drink | Both stores |
| Min OS | iOS 15+; Android 7.0, API 24 | `ios/App/CapApp-SPM/Package.swift`; `android/variables.gradle` `minSdkVersion = 24` |
| Target SDK (Android) | 36 | `android/variables.gradle` `targetSdkVersion = 36`, clears the Play 2025 target-API floor |

---

## 1. App Store Optimisation (ASO)

The copy below lives in `lib/storeListing.ts` with each store's character limit beside it, and `__tests__/storeAssets.test.ts` holds every field to its own limit. Edit it there; this section is the paste sheet.

Keep the name clean and let the subtitle and keyword field carry the search terms. Do not stuff keywords into the name or subtitle, both stores penalise it and Apple bins duplicates between the name, subtitle, and keyword field.

**App name (30 char max, Apple / 30 char, Google):**
> PUBMAXXING

**Subtitle (Apple, 30 char max):**
> Cheap pints near you, tonight

(29 characters. Alternatives if that reads wrong: "London pubs and pint prices" (27), "Find the cheap pint near you" (28).)

**Promotional text (Apple, 170 char, editable without review):**
> Leaving the office and want a good cheap pint near you? PUBMAXX shows the nearest pubs, what a pint costs, and a crawl route home. London only, for now.

**Keyword field (Apple, 100 char, comma-separated, no spaces after commas to save characters):**
> london pubs,pub crawl,pint prices,near me,nightlife,beer,happy hour,bars,pub finder,drinks,taproom

(98 characters. Do not repeat words already in the app name or subtitle, Apple indexes those for free. "cheap pint" used to sit here and was cut for exactly that reason: the subtitle already carries it, so it was spending eleven characters on a term Apple gives us. The old string was also 101 characters, one over the field, which nothing caught until `__tests__/storeAssets.test.ts` measured it.)

**Google Play short description (80 char max):**
> The nearest London pubs, what a pint costs, and a crawl route home.

**Primary ASO targets (the searches this listing is built to win):**
- london pubs
- pub crawl
- pint prices / cheap pint
- pubs near me
- happy hour london

---

## 2. Description drafts

Same body works for both stores. Google Play allows 4000 characters and renders line breaks. Apple allows 4000 in the description field. Dry, plain, no exclamation marks, no "unleash" or "seamless" filler.

### Short version (safe for both)

> PUBMAXX finds you a good cheap pint near where you are, then gets you home.
>
> You have left work. You want a decent pint that does not cost a fortune, somewhere close, without reading forty reviews first. PUBMAXX opens straight on the map, shows the nearest pubs, tells you roughly what a pint costs, and lays out a short crawl you can actually walk.
>
> What you get:
>
> - Nearest pubs, ranked by distance, with pint prices where we have them.
> - A one-tap crawl route that keeps the walking sensible and ends near a way home.
> - Opening hours, last orders, and what is on tonight.
> - A private log of your nights out, with photos if you want them. Yours, on your phone, not a feed for strangers.
>
> London only for now. More cities later.
>
> A note on prices: pubs change them and we do not. We show the best figure we have and when we last saw it. Treat it as a steer, not a promise.
>
> PUBMAXX is free. No account needed to find a pint.

### Long version (Google Play, room to breathe)

> PUBMAXX finds you a good cheap pint near where you are, then gets you home.
>
> Most nights out start the same way. You have left the office, you are somewhere in London, and you want a decent pint that does not cost eight pounds fifty, somewhere you can walk to, without wading through star ratings. PUBMAXX is built for exactly that moment. It opens on the map, works out where you are, and shows you the nearest pubs first.
>
> Find a pint
> - The nearest pubs, ranked by how far you actually have to walk.
> - Pint prices where we have them, with the date we last checked, so you know how fresh the number is.
> - Opening hours and last orders, so you do not arrive to a locked door.
>
> Plan the night
> - Tap once for a crawl route that keeps the walking honest and finishes near a bus, tube, or night route home.
> - See what is on tonight near you.
>
> Keep the night
> - A private log of where you went, kept on your phone. Add a photo from the night if you like. It is yours. It is not posted anywhere and it is not a feed.
>
> Straight answers on prices
> Pubs change their prices and we are not standing at the bar. We show the best figure we hold and when we last saw it. Use it as a rough steer, check at the bar, and do not hold us to the penny.
>
> Privacy
> Full GPS precision stays on your phone. If you ask for nearby events, transport or a journey, the app sends a rounded point for that request. It is not tied to your public profile. Usage analytics are off until you turn them on. There are no adverts and nothing is sold on.
>
> London only for now. More cities are coming.
>
> Free to use. You do not need an account to find a pint.

---

## 3. Category and content

- **Primary category:** Food & Drink (both stores).
- **Secondary category (Apple, optional):** Travel or Lifestyle. Travel fits the "near me while out" use better.
- **Google Play tags:** Food & Drink; optionally "Maps & Navigation" as a secondary.
- **Contains ads:** No.
- **In-app purchases:** No.
- **Price:** Free.

---

## 4. Age rating

The app is about pubs, beer, and pint prices. Alcohol is the subject, not an incidental mention, so answer the alcohol questions as frequent and central. Do not undersell this, an under-rating is a takedown risk.

### Apple App Store (App Store Connect questionnaire)

Answer the ratings questionnaire as follows. Everything not listed is None / No.

| Question | Answer |
| --- | --- |
| Alcohol, Tobacco, or Drug Use or References | **Frequent/Intense** |
| Contests | None |
| Gambling | No (no real or simulated gambling) |
| Horror/Fear, Violence (all kinds) | None |
| Sexual Content or Nudity, Profanity, Crude Humor | None |
| Mature/Suggestive Themes | None |
| Medical/Treatment Information | None |
| Unrestricted Web Access | **Yes** (the shell loads a live website in a web view) |
| Age Verification / Made for Kids | Not made for kids |

Expected result: **17+** (Apple's new 17+ tier for frequent alcohol references, formerly reported as the same band). The "Unrestricted Web Access" yes on its own forces 17+ anyway, which is consistent.

### Google Play (IARC questionnaire)

| Question | Answer |
| --- | --- |
| App category | Reference, News, or Educational / Utility. Choose the closest, then answer content questions honestly. |
| Does the app contain references to alcohol, tobacco, or drugs? | **Yes, references to alcohol** (finding and pricing alcoholic drinks is the core function) |
| Promotes or facilitates the purchase of alcohol? | No (we do not sell or take orders) |
| Gambling, violence, sexual content, language | No / None |
| Does the app share the user's location with other users? | No |
| Users interact / share content? | **Yes.** Social, Messages, Visit Reports, community prices, venue reports, recommendations, and public Moments can carry user content. Reporting, moderation, blocking, account deletion, and the public support contact must work in the submitted build. |

Expected result: **PEGI 18 / ESRB Mature 17+ / "Parental guidance"** band driven by the alcohol reference. Target audience in the Play Console: **18 and over**. Do not select any age band under 18 and do not opt into the Designed for Families / Teacher Approved programmes.

---

## 5. Privacy questionnaire answers

These are derived from the actual code, not aspirations. File references are inline so the owner can verify each line before submitting.

### What the app collects

| Data | Collected? | Linked to identity? | Used for tracking? | Purpose | Evidence |
| --- | --- | --- | --- | --- | --- |
| Precise location | **Yes, only when the user asks for a location feature.** Full GPS precision stays on the device. The app rounds a viewer point to three decimal places before network egress. That is about 70 to 110 metres in London and still falls within Apple and Google Play's precise-location definitions. Request handlers use it ephemerally for nearby listings, conditions, transport, and journey options. | No | No | App functionality | `lib/geo.ts` owns the one three-decimal egress seam. `/api/whats-on`, `/api/tonight-conditions`, `/api/last-train`, `/api/tfl-disruption`, and `/api/citymcp/journey` process the rounded point. TfL, CityMCP, and a user-opened Google Maps journey can receive that rounded point for the requested result. `app/privacy/page.tsx` lists each path. |
| Product interaction / usage data | **Yes, only after the user opts in.** A closed set of named UI events with allow-listed fixed-schema props, plus browser, operating system, device type, screen and viewport size, referrer, campaign parameters, and Web Vitals. | No (pseudonymous device profile only) | No | Analytics | `lib/analytics.ts`: consent-gated (default off), honours Do Not Track, forwards to PostHog EU ingest only when consent is granted; `lib/analyticsEvents.ts` owns closed property schemas with no coordinates or free text. |
| Pseudonymous analytics id | Yes, only after opt-in | No (contains no account or contact data) | No | Analytics | `lib/analytics.ts` `anonymousAnalyticsId()`: an `anon_` UUID created only once consent is `granted`, stored in localStorage and used as PostHog's persistent device identity across page loads and sessions. |
| Device/web push delivery material | Yes, when the user enables notifications | No (stored with no user or plan link) | No | App functionality (public night-signal and installed-web daily-brief pushes) | `lib/nativePush.ts` or explicitly-invoked `lib/webPush.ts` posts to `POST /api/push-tokens`; `lib/pushTokenStore.ts` stores it with no identity column (migrations 0039 + 0046). |
| Photos | Only when the user chooses to publish one. Moment drafts stay on the phone. THREE surfaces take a photo: a Moment, a pub photo wall, and an optional photo on a logged price. | Tied to that content only, not to a real-world identity | No | User content | `lib/momentDraft.ts` keeps Moment drafts in IndexedDB/localStorage on the device; `lib/nightMomentMedia.ts` uploads on publish. Camera access is `lib/nativeCamera.ts`, declared as usage strings in `ios/App/App/Info.plist` and as `CAMERA` plus `READ_MEDIA_IMAGES` in `android/app/src/main/AndroidManifest.xml`. |
| Email address | Only if the user signs in, or asks us to cover an area they name | Yes (it is the contact) | No | Account sign-in, and telling one person we reached the area they asked for | Sign-in is a Supabase magic link (`components/auth/AuthProvider.tsx`); the optional area-demand contact is `app/api/area-demand/route.ts` (most rows carry no address at all). There is no marketing list and no digest capture (`docs/EMAIL_CAPTURE.md`). |

### What the app does not do

- No advertising SDKs, no ad identifiers, no cross-app tracking. Nothing on this list is used to track the user across other companies' apps or sites.
- No selling or sharing of personal data with data brokers.
- No account required to find a pint. Identity is optional and prompted contextually, not at launch.
- No background location access. Full-precision viewer coordinates stay on the device. Rounded coordinates are not shown to other users and are used only to answer a location request.

### Apple App Privacy label (App Store Connect > App Privacy)

Declare the following. Everything else: Not Collected.

- **Data Used to Track You:** None.
- **Data Linked to You:** Contact Info > Email Address (account sign-in or optional area-demand contact), purpose App Functionality. User Content > Photos or Videos (a published Moment, a pub wall photo, or a photo on a logged price), purpose App Functionality.
- **Data Not Linked to You:** Identifiers > Device ID (push token), purpose App Functionality. Usage Data > Product Interaction (opt-in analytics), purpose Analytics. Precise Location, purpose App Functionality, only when the user starts a location feature.
- **Location processing:** declare Precise Location because three decimal places is about 70 to 110 metres. Mark it optional, not linked, not used for tracking, and used for App Functionality. The app processes the rounded point ephemerally. Confirm current processor retention terms in App Store Connect before submission.

### Google Play Data safety form

- **Does your app collect or share any of the required user data types?** Yes.
- **Precise location:** Collected, optional, processed ephemerally, purpose App functionality, not used for tracking. Full GPS precision stays on the device; only the three-decimal point leaves it. In the Data safety flow, identify the ephemeral processing and current service-provider or user-initiated transfers exactly as the form asks.
- **Personal info > Email address:** Collected, not shared, optional, purpose App functionality. Encrypted in transit. Account deletion removes the sign-in address; other erasure requests use the public contact in `lib/siteContact.ts`.
- **Photos and videos:** Collected, purpose App functionality. Answer **shared: yes** for the pub photo wall. A wall photo is PUBLIC by design: it appears on that pub's page to anyone who opens it, and the composer offers a crosspost to the public feed. Saying "not shared publicly by default" would be a wrong answer on the form, not a cautious one. Moment drafts stay on the device and are collected only on publish.
- **App activity > Product interaction:** Collected, not shared, optional (opt-in), purpose Analytics. Encrypted in transit.
- **Device or other IDs:** Collected (push token), not shared, purpose App functionality.
- **Is all data encrypted in transit?** Yes (HTTPS only, the shell loads `https://pubmaxxing.com`).
- **Can users request data deletion?** Yes. Account deletion covers account-linked data; the public contact in `lib/siteContact.ts` handles other requests, including an optional area-demand address and Moments.

**Privacy policy URL:** required by both stores. Use `https://pubmaxxing.com/privacy` — the site publishes it (with `/terms`) from `app/privacy` / `app/terms`; see the AGENTS.md privacy-notice entry for the keep-it-honest rule.

---

## 6. Screenshot shot list

The set is GENERATED from the real screens, not cropped from an old QA run:

```
NEXT_DIST_DIR=.next-prod DEPLOYMENT_VERSION=$(git rev-parse HEAD) npm run build
NEXT_DIST_DIR=.next-prod DEPLOYMENT_VERSION=$(git rev-parse HEAD) PORT=3100 npm start
BASE=http://localhost:3100 npm run gen:store-screenshots
```

Output is `public/store-assets/screenshots/<size>/`, one folder per required
store size, each with its shots and a `manifest.json` carrying the caption to
paste beside each one. `__tests__/storeAssets.test.ts` reads the PNG headers, so
a shot at the wrong pixel size fails rather than being discovered in the upload
form.

Two things the generator refuses on purpose. It will not shoot a `next dev`
server, because the dev overlay badge paints straight onto the phone tab bar.
And it renders each size at its own device viewport rather than upscaling one
frame, because an upscaled 430-wide shot is what makes a listing look like a
photographed website.

**Order (first three carry the listing, most installs decide on those):**

1. **Map, nearest pubs** (`/map`). Caption: "London pubs on the map." The core promise, lead with it.
2. **Pint prices near you** (`/near`). Caption: "What a pint actually costs."
3. **Crawl route** (`/crawls`). Caption: "A crawl you can actually walk."
4. **Tonight** (`/tonight`). Caption: "What is on across London tonight."
5. **Feed** (`/feed`). Caption: "Your night, logged."
6. **Profile** (`/u/you`). Caption: "Private. Yours. Not a feed."

**Required device sizes** (all three are generated):
- Apple: 6.7" (1290x2796) and 6.5" (1242x2688) satisfy the current iPhone requirement. Both are rendered, so no manual resize is needed at upload. iPad screenshots are only needed if the app is offered on iPad; otherwise set availability to iPhone only.
- Google Play: minimum two, up to eight phone screenshots at 9:16, min 320px, max 3840px. The generated `play-phone` set is 1080x1920. A feature graphic (1024x500) is also required.

**Feature graphic (Google Play, 1024x500):** DONE and committed at `public/store-assets/png/play/feature-graphic-1024x500.png`. Ink-deep field (`#060607`), the coral double-struck X read from the one geometry master, wordmark "PUBMAXX" and tagline "Cheap pints near you." Text is fine here; the no-text rule applies to the icon and the splash, which are masked and shown at 20px.

It is the one store asset NOT drawn from an SVG master, and that is deliberate. librsvg resolves `font-family` through the machine's own font stack, so an SVG master asking for Space Grotesk renders in whatever face happens to be installed and says nothing about having done so. The banner is rendered by the same satori path the OG cards use (`scripts/gen-store-assets.mjs`), which is handed the repo's own font file. Do not reintroduce an SVG master for it; `__tests__/storeAssets.test.ts` fails if one appears.

---

## 7. Store visual identity: icon + splash set (issue #440)

**Owner lock (Wave C, #520/#523):** the icon is a clean **white tile with the coral double-struck X**, no text; no ember (static exports drop it). The **splash keeps the ink-deep field** (splashes are not icons, per #523) with the same coral X. This supersedes both the earlier coral-field sources in `assets/` (from the #377 native-readiness pass) and the retired ink-tile / Clink lock; regenerate the native projects from these masters at the next `npx cap sync` (see wiring below).

### SVG masters (source of truth, `public/store-assets/`)

| File | Native size | Role |
| --- | --- | --- |
| `icon-square.svg` | 1024 | Icon master: pure white (`#ffffff`) field, coral double-struck X at scale 0.82. Full bleed, no rounding (both stores mask). |
| `icon-square-small.svg` | 64 | Small-size optics for exports at or under 64px: same white tile, but the single-slash `slashSimple` + thick stroke (the double-struck channel closes up below ~24px). |
| `play-adaptive-foreground.svg` | 1024 | Play adaptive foreground: coral double-struck X on transparent, 108dp canvas, mark inside the 66dp safe circle (farthest stroke corner ~29.3dp from centre at scale 0.9). |
| `play-adaptive-background.svg` | 1024 | Play adaptive background: solid white, deliberately flat (parallax layer). |
| `splash.svg` | 2732 | Splash: ink-deep field (kept per #523), centred coral X at scale 0.28, faint glow. One splash serves light and dark. |

Colour and geometry are pinned to `lib/ogBrand.tsx` / `docs/BRAND_MARK.md` by `__tests__/storeAssets.test.ts` (hexes, canonical double-struck X endpoints, white icon tile, no ember, no `<text>`, flat background layer).

### PNG export set (committed, `public/store-assets/png/`)

Regenerate any time the masters change:

```
node scripts/gen-store-assets.mjs
```

| Output | Sizes | Notes |
| --- | --- | --- |
| `ios/AppIcon-{size}.png` | 20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024 | Opaque, alpha stripped (the 1024 marketing slot rejects alpha). Sizes at or under 64 render from the small-optics master. |
| `play/play-store-512.png` | 512 | Play Console listing icon. |
| `play/adaptive-foreground-432.png` | 432 | 108dp at xxxhdpi, keeps transparency. |
| `play/adaptive-background-432.png` | 432 | Flat white. |
| `splash/splash-2732.png` | 2732 | Capacitor splash source, covers the largest iPad requirement. |
| `play/feature-graphic-1024x500.png` | 1024x500 | Play listing banner. The one export with words on it, and the one rendered through satori rather than from an SVG master (see section 6). |

### Legibility at small sizes (checked)

Coral `#ff5a5f` on a white `#ffffff` tile measures ~3.7:1 contrast — comfortably above the 3:1 large-graphic threshold and crisper on a home screen than the retired coral-on-ink treatment. The full double-struck X holds at 40px+, but its two thin ascending strokes (~4u channel) merge below ~24px, so the ≤64px small-optics master takes the single-slash `slashSimple` + thick descending stroke instead — one clean forward slash that stays legible at the 20px slot. No ember at any tier (the crossing is already the event). Verified by sampling rendered pixels on the 29px, 512px and 1024px exports (white field, coral stroke).

### Wiring into the native shells (when syncing)

- **iOS:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/` uses a single universal 1024 (`AppIcon-512@2x.png`); replace its contents with `png/ios/AppIcon-1024.png` at the next native pass. The full classic slot set exists for older Xcode setups and App Store Connect uploads.
- **Android / Play:** upload `play-store-512.png` in the Play Console; the adaptive layers feed `@capacitor/assets` (or hand-placed `mipmap` resources) at sync time.
- **Capacitor splash:** feed `splash/splash-2732.png` as both `splash` and `splash-dark` sources, the ink-dark art is the same for both (the splash keeps the ink field even though the icon is now a white tile), then `npx @capacitor/assets@3 generate` (fetched ephemerally, see the header of `scripts/gen-native-app-icons.mjs` for the npm-audit rationale).

### Manual export fallback (no sharp)

`scripts/gen-store-assets.mjs` needs the `sharp` package (already a dependency). If it cannot load in some environment, do not add a new raster dependency: open each SVG master in any renderer (`rsvg-convert -w <size> -h <size>`, Inkscape, Figma) and export the table above, using `icon-square-small.svg` for sizes at or under 64px and stripping alpha on the iOS set.

---

## 8. Owner-only remaining steps

Everything above is done or ready to paste. The steps below need a real account, real money, or a physical signing step, and only the owner can do them. Nothing here is blocked by the codebase.

### Apple App Store

- [ ] **Enrol** in the Apple Developer Program, 99 USD per year, at developer.apple.com. Individual or Organization. Note the **Team ID** once issued.
- [ ] **Activate Sign in with Apple when wanted:** create the App ID, Services ID, return URL, and provider key, then enable Apple in Supabase. [`DEPLOYMENT.md`](./DEPLOYMENT.md#apple) owns the detailed provider setup.
- [ ] **Verify native auth return:** replace the `TEAMID` placeholder, add the Associated Domains capability, deploy the updated association file, then prove email, Google, and Apple callback URLs return to the signed-in app on a physical iPhone. Code accepts exact `/auth/callback`; association and device proof remain owner gates.
- [ ] **Install full Xcode** from the Mac App Store (not just Command Line Tools). Confirm `xcode-select -p` points at `…/Xcode.app`.
- [ ] `npm ci` then `npx cap sync ios`, then `npx cap open ios` to open the project in Xcode.
- [ ] **Signing:** App target > Signing & Capabilities, select the team, confirm bundle id `com.pubmaxx.app`. Let Xcode manage signing.
- [ ] **Certificates and profiles** are auto-managed by Xcode once the team is set. No manual keychain work needed for a first upload.
- [ ] **Push (only when you want notifications live):** add the Push Notifications capability, create an APNs Auth Key in the developer portal, and set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_ENV` on the server. Use `APNS_ENV=production` for TestFlight and App Store production tokens. Use `APNS_ENV=sandbox` only for development-signed sandbox tokens. Missing or invalid `APNS_ENV` fails closed when credentials are configured. Never commit the `.p8` key. Verify delivery on the matching signed device. The APNs HTTP/2 transport exists in `lib/pushProvider.ts`; credentials, entitlement, signing, and device proof remain owner-only. See `docs/CAPACITOR_WRAP.md`.
- [ ] **Universal links:** add the Associated Domains capability `applinks:pubmaxxing.com`, and replace the `TEAMID` placeholder in `public/.well-known/apple-app-site-association` with the real Team ID. Sign-in return depends on this gate.
- [ ] **Create the app record in App Store Connect: name PUBMAXXING**, bundle id `com.pubmaxx.app`, primary language English (UK), category Food & Drink.
- [ ] **Paste metadata** from sections 1 to 5 of this doc. Upload screenshots from section 6.
- [ ] **Archive and upload** the first build: Xcode > Product > Archive > Distribute App > App Store Connect.
- [ ] **TestFlight** internal test on your own device before submitting for review.
- [ ] **Submit for review.** Do not submit until the three native superpowers are demonstrably live (real camera, push delivery, universal links), or expect a thin-wrapper rejection. See `docs/IOS_APP_PRD.md` section 4 step 9.

### Google Play

Ordered. Each step is meant to be done in the order written and most of them are
a command to paste. Everything the codebase could do is done; what is left needs
the account, a payment, or a signing step only the owner can take.

Nothing below invents a value. Where a real one is needed the file carries an
obvious placeholder, and the step says which screen hands you the real one.

**1. Enrol, first, because it is the long pole.** play.google.com/console, 25 USD
once. Complete identity verification. For a personal account this can take
several days, and nothing after step 9 can happen until it clears. Start it
before touching anything else.

**2. Install the toolchain.** JDK 21 and the Android SDK command-line tools.

```
brew install --cask android-commandlinetools
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
yes | sdkmanager --licenses
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

For the JDK, `brew install --cask temurin@21` runs Apple's system installer and
therefore asks for a sudo password. If you would rather not give it one, or you
are on the nix-managed Homebrew where formula post-install steps fail, unpack
the same JDK into your home directory instead. Nothing needs it on the PATH
globally:

```
curl -L -o /tmp/temurin21.tar.gz \
  "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
mkdir -p ~/.local/jdk && tar -xzf /tmp/temurin21.tar.gz -C ~/.local/jdk
export JAVA_HOME=$(ls -d ~/.local/jdk/jdk-21*/Contents/Home)
export PATH="$JAVA_HOME/bin:$PATH"
java -version   # must report 21
```

Then point Gradle at the SDK. `android/local.properties` is gitignored:

```
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```

**3. Prove the build before touching the account.**

```
npm ci
npx cap sync android
(cd android && ./gradlew bundleRelease)
```

It will print that `keystore.properties` is absent and that the bundle is
unsigned, and that `google-services.json` is absent and push will not register.
Both are true and both are fixed below. A `BUILD SUCCESSFUL` here means the only
things left are account-shaped.

Nothing needs changing to clear Play's target-API requirement: `compileSdk` and
`targetSdk` are already 36 in `android/variables.gradle`.

**4. Firebase, for push.** console.firebase.google.com, create or reuse a
project, add an Android app with package name **`com.pubmaxx.app`**, download the
`google-services.json` it gives you and save it as `android/app/google-services.json`.
It is gitignored; do not commit it. `android/app/google-services.json.example`
carries the same steps beside the file.

Then, in the same project: Project settings, Service accounts, Generate new
private key. That JSON is the SERVER half and is a real secret. From it set all
four of `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY_ID` and
`FCM_PRIVATE_KEY` on the deployment. All four or none: `lib/fcmPushProvider.ts`
refuses rather than half-sending.

**5. Generate the upload key. This is the one irreversible step.** It signs every
future update and Google cannot simply reissue it. Keep the file and the
password somewhere you will still have them in three years.

```
keytool -genkeypair -v \
  -keystore ~/pubmaxx-upload.jks \
  -alias pubmaxx-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then write `android/keystore.properties`, which is gitignored along with every
`*.jks` and `*.keystore`:

```
storeFile=/Users/<you>/pubmaxx-upload.jks
storePassword=<the store password you just set>
keyAlias=pubmaxx-upload
keyPassword=<the key password you just set>
```

Keep the keystore OUTSIDE the repository. Rebuild and confirm the first line
changes to "Release builds sign with the upload key":

```
(cd android && ./gradlew bundleRelease)
jarsigner -verify android/app/build/outputs/bundle/release/app-release.aab   # "jar verified"
```

The uploadable file is `android/app/build/outputs/bundle/release/app-release.aab`.

**Every upload after the first needs a higher `versionCode`.** It is `1` in
`android/app/build.gradle` and Play rejects a bundle whose code it has already
seen, which is the rejection you will hit during the closed test rather than on
the first upload. Raise it by one and rebuild each time; `versionName` is the
string people read and can stay put or move as you like, but the CODE must
climb.

**6. Create the app in the Play Console: name PUBMAXXING**, default language
English (United Kingdom), app not game, free. Category **Food & Drink**.

**7. Opt into Play App Signing** when the console offers it on the first upload
(Setup, App integrity). Recommended: Google holds the app signing key, your
upload key stays replaceable if it is ever lost. Accept it.

**8. Content rating (IARC questionnaire).** Answers are section 4 of this
document. The short version: category Utility or Reference; **yes, references to
alcohol** (finding and pricing alcoholic drinks is the whole app); **no** to
promoting or facilitating the purchase of alcohol, because nothing is sold or
ordered here; no to gambling, violence, sexual content and language; **no** to
sharing the user's location with other users; **yes** to users interacting and
sharing content. Do not undersell the alcohol answer, an under-rating is a
takedown risk.

**9. Target audience and content.** Set target age to **18 and over** only. Do
not tick any band under 18 and do not opt into Designed for Families.

**10. Data safety form.** Answers are section 5. In the order the form asks:

- Does your app collect or share any of the required user data types? **Yes.**
- Is all of the user data collected by your app encrypted in transit? **Yes.**
- Do you provide a way for users to request that their data is deleted? **Yes.**
- **Location > Approximate location:** not collected.
- **Location > Precise location:** collected, not shared. Optional. Purpose: App
  functionality. Processed ephemerally. Full GPS precision stays on the device;
  the app rounds to three decimal places before anything leaves it, which is
  still precise location by Play's definition.
- **Personal info > Email address:** collected, not shared. Optional. Purpose:
  App functionality (sign-in, and the optional area-demand contact).
- **Photos and videos > Photos:** collected AND **shared**. Purpose: App
  functionality. A pub wall photo is public by design, so "shared" is the honest
  answer here and "not shared" would be a wrong one.
- **App activity > App interactions:** collected, not shared. Optional, because
  analytics are opt-in and default off. Purpose: Analytics.
- **Device or other IDs:** collected, not shared. Purpose: App functionality
  (the push token, stored with no identity column).
- Everything else on the form: **not collected**.
- Privacy policy URL: `https://pubmaxxing.com/privacy`

**11. Store listing.** App name, short description and full description are
section 2. Upload from this repository:

- Icon (512x512): `public/store-assets/png/play/play-store-512.png`
- Feature graphic (1024x500): `public/store-assets/png/play/feature-graphic-1024x500.png`
- Phone screenshots (1080x1920, at least two): the six PNGs in
  `public/store-assets/screenshots/play-phone/`, in filename order. That folder's
  `manifest.json` carries the caption for each one.

**12. Upload to Internal testing first.** Install on your own device from the
internal link and prove the three native superpowers actually work, because a
wrapper that does none of them is the rejection this whole exercise exists to
avoid:

- **Camera:** log a price with a photo, and post a photo to a pub wall. The OS
  permission dialog must appear the first time, and the sheet must offer the
  photo library as well as the camera.
- **Push:** confirm a registration token reaches `POST /api/push-tokens` with
  platform `android`, send one, and confirm the tap lands on the path the
  payload named.
- **App links:** step 13, which needs the fingerprint this upload just created.

**13. Publish the App Links fingerprint.** In the Play Console: Setup, App
integrity, App signing. Copy the **SHA-256 certificate fingerprint of the app
signing key** (Google's, not your upload key). Paste it into
`public/.well-known/assetlinks.json` in place of
`REPLACE_WITH_PLAY_APP_SIGNING_SHA256`, keeping the colon-separated uppercase hex
form, and deploy the site. Then on the device:

```
adb shell pm verify-app-links --re-verify com.pubmaxx.app
adb shell pm get-app-links com.pubmaxx.app     # pubmaxxing.com: verified
```

Until this is done the state reads as a failure and shared links keep opening
the browser. Finally, prove the email, Google and Apple sign-in callbacks return
into the signed-in app rather than a browser tab.

**14. Closed test, if this is a personal account created after November 2023.**
Play requires a closed test with at least **12 testers who stay opted in for 14
continuous days** before you may apply for production access. Budget for it
rather than discovering it at the end.

Recommended order, because it costs no extra waiting: start the closed test the
moment step 12 passes, and submit the iOS build for review while those 14 days
run. Apple's review is usually days rather than weeks, so the two clocks overlap
and Play's 14 days becomes the only real wait.

**15. Apply for production access, then roll out.** Start at a staged
percentage rather than 100% so the first crash reports arrive from a small
audience.

### Shared, not account-blocked

- [x] **Publish a privacy policy page** — done: `https://pubmaxxing.com/privacy` (and `/terms`) ship from `app/privacy` / `app/terms`, linked in the site footer. Use that URL in both listings.
