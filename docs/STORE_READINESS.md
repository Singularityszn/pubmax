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
| Photos (Moments) | Only when the user chooses to share a Moment. Drafts stay on the phone. | Tied to that content only, not to a real-world identity | No | User content | `lib/momentDraft.ts` keeps drafts in IndexedDB/localStorage on the device; `lib/nightMomentMedia.ts` uploads to Supabase storage only on publish. Camera access is via `lib/nativeCamera.ts` with the usage strings in `ios/App/App/Info.plist`. |
| Email address | Only if the user signs in, or asks us to cover an area they name | Yes (it is the contact) | No | Account sign-in, and telling one person we reached the area they asked for | Sign-in is a Supabase magic link (`components/auth/AuthProvider.tsx`); the optional area-demand contact is `app/api/area-demand/route.ts` (most rows carry no address at all). There is no marketing list and no digest capture (`docs/EMAIL_CAPTURE.md`). |

### What the app does not do

- No advertising SDKs, no ad identifiers, no cross-app tracking. Nothing on this list is used to track the user across other companies' apps or sites.
- No selling or sharing of personal data with data brokers.
- No account required to find a pint. Identity is optional and prompted contextually, not at launch.
- No background location access. Full-precision viewer coordinates stay on the device. Rounded coordinates are not shown to other users and are used only to answer a location request.

### Apple App Privacy label (App Store Connect > App Privacy)

Declare the following. Everything else: Not Collected.

- **Data Used to Track You:** None.
- **Data Linked to You:** Contact Info > Email Address (account sign-in or optional area-demand contact), purpose App Functionality. User Content > Photos or Videos (Moments, on publish), purpose App Functionality.
- **Data Not Linked to You:** Identifiers > Device ID (push token), purpose App Functionality. Usage Data > Product Interaction (opt-in analytics), purpose Analytics. Precise Location, purpose App Functionality, only when the user starts a location feature.
- **Location processing:** declare Precise Location because three decimal places is about 70 to 110 metres. Mark it optional, not linked, not used for tracking, and used for App Functionality. The app processes the rounded point ephemerally. Confirm current processor retention terms in App Store Connect before submission.

### Google Play Data safety form

- **Does your app collect or share any of the required user data types?** Yes.
- **Precise location:** Collected, optional, processed ephemerally, purpose App functionality, not used for tracking. Full GPS precision stays on the device; only the three-decimal point leaves it. In the Data safety flow, identify the ephemeral processing and current service-provider or user-initiated transfers exactly as the form asks.
- **Personal info > Email address:** Collected, not shared, optional, purpose App functionality. Encrypted in transit. Account deletion removes the sign-in address; other erasure requests use the public contact in `lib/siteContact.ts`.
- **Photos and videos:** Collected (on Moment publish), not shared publicly by default, purpose App functionality.
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

**Feature graphic (Google Play, 1024x500):** ink-deep field (`#060607`) with the coral double-struck X mark, per the identity lock in section 7, plus wordmark "PUBMAXX" and tagline "Cheap pints near you." (text is fine on the feature graphic, the no-text rule applies to the icon and splash). Start from the `public/store-assets/splash.svg` composition (which keeps the ink field).

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

Do the steps in this order. Each one names the command to run and what "done"
looks like. Steps 1 to 3 are account work. Steps 4 to 9 are one Xcode session.
Steps 10 to 15 are App Store Connect.

Nothing in the repository blocks any of this. The Team ID is the only value the
code still waits for, and it goes in exactly one file (step 3).

**1. Enrol in the Apple Developer Program.**
Go to <https://developer.apple.com/programs/enroll/>. Pay 99 USD per year.
Choose Individual or Organization.
*Done when:* Apple shows your **Team ID**, ten characters, at
<https://developer.apple.com/account> under Membership details. Copy it.

**2. Install full Xcode.**
Install Xcode from the Mac App Store. Command Line Tools alone cannot build the
app. Then point the toolchain at it:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcode-select -p
```

*Done when:* the second command prints a path inside `Xcode.app`.

**3. Put the Team ID in the association file.**
Replace `TEAMID` in `public/.well-known/apple-app-site-association` with the
Team ID from step 1. There is one occurrence.

```sh
sed -i '' 's/TEAMID\.com\.pubmaxx\.app/<YOUR_TEAM_ID>.com.pubmaxx.app/' \
  public/.well-known/apple-app-site-association
grep appIDs public/.well-known/apple-app-site-association
```

*Done when:* the file reads `"appIDs": ["<YOUR_TEAM_ID>.com.pubmaxx.app"]`.
Commit and deploy this before step 14, or universal links stay unverified.
Note that `__tests__/iosCapabilities.test.ts` expects the placeholder, so update
that test in the same commit.

**4. Open the project.**

```sh
npm ci
npx cap sync ios
npx cap open ios
```

*Done when:* Xcode opens `ios/App/App.xcodeproj` and indexing finishes.

**5. Set the signing team.**
Select the **App** target, then Signing & Capabilities. Tick *Automatically
manage signing*. Choose your team. The bundle id is already `com.pubmaxx.app`.
*Done when:* Xcode shows a provisioning profile and no signing error.
Certificates and profiles need no manual keychain work.

**6. Confirm the two capabilities appeared.**
`ios/App/App/App.entitlements` is in the repository and both build
configurations point at it, so Xcode reads it rather than asking you to add
anything.
*Done when:* Signing & Capabilities lists **Push Notifications** and
**Associated Domains** with `applinks:pubmaxxing.com`. If either is missing,
the team in step 5 did not apply. Do not add them by hand: that writes a second
entitlements file and the two then disagree.

**7. Create the APNs Auth Key.**
Go to <https://developer.apple.com/account/resources/authkeys/list>. Create a
key. Tick *Apple Push Notifications service (APNs)*. Download the `.p8` file
once, because Apple does not offer it twice. Keep it out of the repository.
*Done when:* you hold the `.p8` file, its **Key ID**, and your Team ID.

**8. Set the four APNs values on the server.**
Set all four together in the Vercel project, Production and Preview:

| Variable | Value |
| --- | --- |
| `APNS_KEY_ID` | the Key ID from step 7 |
| `APNS_TEAM_ID` | the Team ID from step 1 |
| `APNS_PRIVATE_KEY` | the whole `.p8` file contents, newlines included |
| `APNS_ENV` | `sandbox` for a build you run from Xcode, `production` for TestFlight and the App Store |

*Done when:* a redeployed server has all four. A partial set fails closed and
sends nothing, which is deliberate. `lib/pushProvider.ts` speaks HTTP/2 to APNs
and needs no other change.

**9. Build to a simulator, then to your iPhone.**

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

*Done when:* the build succeeds, and the app opens pubmaxxing.com. Then run it
on your own iPhone from Xcode, because the simulator has no camera and receives
no push.

**10. Prove the three superpowers on the iPhone.**
This is the gate that decides whether the app reads as a wrapped website.

- **Camera.** Open a pub, tap Add photo on the price panel and on the photo
  wall. The iOS sheet must offer Camera and Photo Library. Take one photo and
  post it.
- **Push.** Log a price, accept the notification explainer, then grant the
  system permission. Check `push_tokens` holds a new `ios` row. Send one push
  and tap it.
- **Universal links.** Message yourself `https://pubmaxxing.com/tonight` and
  `https://pubmaxxing.com/map?sel=<a venue id>`. Tap each from Messages.

*Done when:* all three work on the device, not the simulator. Section 8 of this
document and `docs/IOS_APP_PRD.md` section 4 step 9 both hold the app to this
before submission.

**11. Create the app record in App Store Connect: name PUBMAXXING.**
Go to <https://appstoreconnect.apple.com/apps>, then the plus button, then New
App. Bundle id `com.pubmaxx.app`. Primary language English (UK). Category Food
& Drink. SKU `pubmaxxing-ios`.
*Done when:* the app appears with status *Prepare for Submission*.

**12. Paste the metadata and upload the screenshots.**
Sections 1 to 3 of this document hold the name, subtitle, keywords, and both
descriptions. Section 5 holds every App Privacy answer. Section 4 holds the age
rating answers. The screenshots are already rendered at both required sizes in
`public/store-assets/screenshots/ios-6.7/` and
`public/store-assets/screenshots/ios-6.5/`, and each folder's
`manifest.json` carries the caption for each shot.
*Done when:* App Privacy shows no outstanding questions and both screenshot
sizes are uploaded.

**13. Activate Sign in with Apple, only if you want it at launch.**
Create the App ID, Services ID, return URL, and provider key, then enable Apple
in Supabase. [`DEPLOYMENT.md`](./DEPLOYMENT.md#apple) owns the detailed steps.
*Done when:* an Apple sign-in returns to the signed-in app. Email and Google
sign-in already work without this step.

**14. Archive and upload the first build.**
In Xcode choose a Generic iOS Device, then Product > Archive, then Distribute
App > App Store Connect > Upload.
*Done when:* the build appears in App Store Connect, usually within an hour.
Apple emails about any missing privacy declaration; the repository ships
`ios/App/App/PrivacyInfo.xcprivacy`, which answers the required-reason and
data-collection questions.

**15. TestFlight, then submit.**
Install the build on your own iPhone through TestFlight. Repeat step 10 on the
TestFlight build, because the entitlement environment changes between a build
run from Xcode and a distributed one. Then submit for review.
*Done when:* the app is *Waiting for Review*. Do not submit before step 10
passes on TestFlight, or expect a thin-wrapper rejection.

### Google Play

- [ ] **Enrol** in the Google Play Console, 25 USD one-time, at play.google.com/console. Complete identity verification (can take a few days for individual accounts, start this early, it is the long pole).
- [ ] **Install Android Studio** for signing and bundle work, plus **JDK 21**. Confirm `java -version` reports 21 before `./gradlew` runs in `android/`; generated Capacitor Gradle compiles with Java 21.
- [ ] `npm ci` then `npx cap sync android`, then `npx cap open android` to open the project in Android Studio.
- [ ] **Upload key / signing:** opt into Play App Signing (recommended). Generate an upload keystore once (`keytool` or Android Studio > Generate Signed Bundle), keep it safe, it signs every future update. This is the one irreversible owner step, do not lose the keystore.
- [ ] **Build the release bundle:** Android Studio > Build > Generate Signed App Bundle (.aab), or `./gradlew bundleRelease`. Target SDK is already 36, which clears the Play target-API requirement.
- [ ] **Push:** source delivery is implemented through platform-routed FCM HTTP v1. Create a Firebase project, add Android package `com.pubmaxx.app`, and place its real `google-services.json` in `android/app/`. Set all four server values `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY_ID`, and `FCM_PRIVATE_KEY`. Then prove token registration, notification receipt, and safe tap navigation on a physical configured build. Never commit the service-account JSON or private key.
- [ ] **Publish verified App Links:** add the release signing fingerprint to `/.well-known/assetlinks.json`, deploy it, then prove email, Google, and Apple callback URLs return to the signed-in app on a physical Android device.
- [ ] **Create the app in the Play Console: name PUBMAXXING**, category Food & Drink, free.
- [ ] **Complete the Data safety form** and **content rating (IARC) questionnaire** from sections 4 and 5.
- [ ] **Set target audience** to 18 and over. Do not opt into Designed for Families.
- [ ] **Paste metadata** from sections 1 to 3. Upload screenshots and the 1024x500 feature graphic from section 6.
- [ ] **Upload the .aab** to the Internal testing track first, install on your own device, then promote to Production.
- [ ] **Roll out.** New personal Play accounts created after Nov 2023 also need a closed test with 12+ testers for 14 days before production, budget for that.

### Shared, not account-blocked

- [x] **Publish a privacy policy page** — done: `https://pubmaxxing.com/privacy` (and `/terms`) ship from `app/privacy` / `app/terms`, linked in the site footer. Use that URL in both listings.
