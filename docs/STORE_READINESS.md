# PUBMAXX Store Readiness Pack

**Status:** Everything on this page is pre-writable now, without an Apple or Google developer account. It is the copy, metadata, and answer sheet the owner pastes into App Store Connect and the Google Play Console once enrolment clears. The only work that genuinely needs a paid account is enrolment, certificates, and the first binary upload, listed as the owner checklist in the last section.

**App:** PUBMAXX. London pub finder, crawl planner, and night log, wrapped in a Capacitor shell over `https://pubmaxxing.com` (see `docs/IOS_APP_PRD.md`, `docs/CAPACITOR_WRAP.md`).

**Identity (already fixed in the repo, do not change):**

| Field | Value | Source |
| --- | --- | --- |
| App name | PUBMAXX | `capacitor.config.ts` `appName`; iOS `CFBundleDisplayName`; Android `app_name` |
| iOS bundle id | `com.pubmaxx.app` | `capacitor.config.ts` `appId` |
| Android applicationId | `com.pubmaxx.app` | `android/app/build.gradle` (same string, iOS convention) |
| Version name | 1.0 | `android/app/build.gradle` `versionName`; iOS `MARKETING_VERSION` |
| Version code / build | 1 | `android/app/build.gradle` `versionCode`; iOS `CURRENT_PROJECT_VERSION` |
| Category | Food & Drink | Both stores |
| Min OS | iOS 14+ (Capacitor 8 default); Android 7.0, API 24 | `android/variables.gradle` `minSdkVersion = 24` |
| Target SDK (Android) | 36 | `android/variables.gradle` `targetSdkVersion = 36`, clears the Play 2025 target-API floor |

---

## 1. App Store Optimisation (ASO)

Keep the name clean and let the subtitle and keyword field carry the search terms. Do not stuff keywords into the name or subtitle, both stores penalise it and Apple bins duplicates between the name, subtitle, and keyword field.

**App name (30 char max, Apple / 30 char, Google):**
> PUBMAXX

**Subtitle (Apple, 30 char max):**
> Cheap pints near you, tonight

(29 characters. Alternatives if that reads wrong: "London pubs and pint prices" (27), "Find the cheap pint near you" (28).)

**Promotional text (Apple, 170 char, editable without review):**
> Leaving the office and want a good cheap pint near you? PUBMAXX shows the nearest pubs, what a pint costs, and a crawl route home. London only, for now.

**Keyword field (Apple, 100 char, comma-separated, no spaces after commas to save characters):**
> london pubs,pub crawl,pint prices,cheap pint,near me,nightlife,beer,happy hour,bars,pub finder,drinks

(That string is 100 characters exactly. Do not repeat words already in the app name or subtitle, Apple indexes those for free. "pub" and "london" are already implied by the listing.)

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
> Your location is used on your phone to sort pubs by distance. It is not sent to us and it is not tied to your name. Usage analytics are off until you turn them on. There are no adverts and nothing is sold on.
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
| Users interact / share content? | Moments are private to the user by default. If any sharing surface is public at review time, answer Yes and describe it. |

Expected result: **PEGI 18 / ESRB Mature 17+ / "Parental guidance"** band driven by the alcohol reference. Target audience in the Play Console: **18 and over**. Do not select any age band under 18 and do not opt into the Designed for Families / Teacher Approved programmes.

---

## 5. Privacy questionnaire answers

These are derived from the actual code, not aspirations. File references are inline so the owner can verify each line before submitting.

### What the app collects

| Data | Collected? | Linked to identity? | Used for tracking? | Purpose | Evidence |
| --- | --- | --- | --- | --- | --- |
| Precise / coarse location | **Not collected off-device.** The app requests location permission and uses it on the phone only, to sort pubs by distance. Coordinates are never sent to our servers. | No | No | App functionality (near-me ranking) | `components/nearme/NearMeNow.tsx` calls `rankNearMe(position.coords…)` against the in-memory slim index; the coordinates never leave the client. `PubMap.tsx`, `CityChooser.tsx` use geolocation client-side only. |
| Product interaction / usage data | **Yes, only after the user opts in.** A closed set of about ten named UI events (badge tap, booking click, tour complete, and similar) with allow-listed enum props. | No (pseudonymous id only) | No | Analytics | `lib/analytics.ts`: consent-gated (default off), honours Do-Not-Track, forwards to PostHog EU ingest only when consent is granted; props are an enum allow-list in `lib/analyticsEvents.ts` with no coordinates or free text. |
| Pseudonymous analytics id | Yes, only after opt-in | No (contains no account, contact, or location data) | No | Analytics | `lib/analytics.ts` `anonymousAnalyticsId()`: an `anon_` UUID created only once consent is `granted`, stored in localStorage. |
| Device push token | Yes, when the user enables notifications | No (stored with no user or plan link) | No | App functionality (send the night-signal "went live" push) | `lib/nativePush.ts` posts the token to `POST /api/push-tokens`; `lib/pushTokenStore.ts` stores it with no identity column (see `supabase/migrations/…_0039_push_tokens.sql`). |
| Photos (Moments) | Only when the user chooses to share a Moment. Drafts stay on the phone. | Tied to that content only, not to a real-world identity | No | User content | `lib/momentDraft.ts` keeps drafts in IndexedDB/localStorage on the device; `lib/nightMomentMedia.ts` uploads to Supabase storage only on publish. Camera access is via `lib/nativeCamera.ts` with the usage strings in `ios/App/App/Info.plist`. |
| Email address | Only if the user submits it to get updates | Yes (it is the contact) | No | App functionality (email updates the user asked for), with confirm/unsubscribe | `app/api/email-subscribers/route.ts` and `confirm` / `unsubscribe` routes. Double opt-in. |

### What the app does not do

- No advertising SDKs, no ad identifiers, no cross-app tracking. Nothing on this list is used to track the user across other companies' apps or sites.
- No selling or sharing of personal data with data brokers.
- No account required to find a pint. Identity is optional and prompted contextually, not at launch.
- Location is never transmitted to the server or shared with other users.

### Apple App Privacy label (App Store Connect > App Privacy)

Declare the following. Everything else: Not Collected.

- **Data Used to Track You:** None.
- **Data Linked to You:** Contact Info > Email Address (only if the user submits it), purpose App Functionality. User Content > Photos or Videos (Moments, on publish), purpose App Functionality.
- **Data Not Linked to You:** Identifiers > Device ID (push token), purpose App Functionality. Usage Data > Product Interaction (opt-in analytics), purpose Analytics.
- **Location:** Because location is processed only on device and never leaves it, Apple's rules mean it is not "collected". Do not declare it as collected. It is still gated by the standard iOS location permission prompt at runtime.

### Google Play Data safety form

- **Does your app collect or share any of the required user data types?** Yes.
- **Location:** Not collected (processed on-device only). If the reviewer disagrees because the permission is present, be ready to explain the on-device-only handling above.
- **Personal info > Email address:** Collected, not shared, optional, purpose App functionality. Encrypted in transit. User can request deletion (unsubscribe route).
- **Photos and videos:** Collected (on Moment publish), not shared publicly by default, purpose App functionality.
- **App activity > Product interaction:** Collected, not shared, optional (opt-in), purpose Analytics. Encrypted in transit.
- **Device or other IDs:** Collected (push token), not shared, purpose App functionality.
- **Is all data encrypted in transit?** Yes (HTTPS only, the shell loads `https://pubmaxxing.com`).
- **Can users request data deletion?** Yes for email (unsubscribe) and Moments; describe the contact route.

**Privacy policy URL:** required by both stores. Point at the site's privacy page (confirm the live URL before submitting, for example `https://pubmaxxing.com/privacy`). If that page does not exist yet, it must be published before either store submission. This is the one store-metadata dependency that is not code and not an account step.

---

## 6. Screenshot shot list

Screenshots already exist in `docs/screenshots` from the Gate Z set (`docs/screenshots/GATE_Z_2026-07-12.md`), rendered at phone widths (390 and 430) in light and dark. Use the 430-wide light frames as the base, they map cleanly to the 6.5" and 6.7" required sizes. Reshoot inside the shell only if a device pass shows shell-specific chrome worth capturing.

**Order (first three carry the listing, most installs decide on those):**

1. **Map, nearest pubs**: `map-clean-*-430.png` or `map-sheet-*-430.png`. Caption: "The nearest pubs, right now." This is the core promise, lead with it.
2. **Pint price on a venue**: `venue-desktop` equivalent at 430, or `map-sheet` with a price visible. Caption: "What a pint actually costs."
3. **Crawl route**: `crawls-*-430.png` or `mobile-suggested-crawl.png`. Caption: "A crawl you can actually walk."
4. **Tonight / what is on**: `tonight-*-430.png` or `w1-tonight-sheet-*.png`. Caption: "What is on near you tonight."
5. **Activity / feed**: `activity-*-430.png` or `feed-*-430.png`. Caption: "Your night, logged."
6. **Profile / private log**: `profile-you-*-430.png`. Caption: "Private. Yours. Not a feed."

**Required device sizes:**
- Apple: 6.7" (1290x2796) and 6.5" (1242x2688) are the two that satisfy the current iPhone requirement. One set can cover both if uploaded at 6.7". iPad screenshots only needed if the app is offered on iPad (it is universal-capable, so either provide 12.9" iPad shots or set availability to iPhone only).
- Google Play: minimum two, up to eight, phone screenshots at 16:9 or 9:16, min 320px, max 3840px. The 430-wide frames upscale fine. A feature graphic (1024x500) is also required, build it from the brand mark on the coral field.

**Feature graphic (Google Play, 1024x500):** coral field (`#ff5a5f`), the Crossing mark, wordmark "PUBMAXX", tagline "Cheap pints near you." Reuse `assets/splash.png` composition as the starting point.

---

## 7. Owner-only remaining steps

Everything above is done or ready to paste. The steps below need a real account, real money, or a physical signing step, and only the owner can do them. Nothing here is blocked by the codebase.

### Apple App Store

- [ ] **Enrol** in the Apple Developer Program, 99 USD per year, at developer.apple.com. Individual or Organization. Note the **Team ID** once issued.
- [ ] **Install full Xcode** from the Mac App Store (not just Command Line Tools). Confirm `xcode-select -p` points at `…/Xcode.app`.
- [ ] `npm ci` then `npx cap sync ios`, then `npx cap open ios` to open the project in Xcode.
- [ ] **Signing:** App target > Signing & Capabilities, select the team, confirm bundle id `com.pubmaxx.app`. Let Xcode manage signing.
- [ ] **Certificates and profiles** are auto-managed by Xcode once the team is set. No manual keychain work needed for a first upload.
- [ ] **Push (only when you want notifications live):** add the Push Notifications capability, create an APNs Auth Key in the developer portal, set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` on the server. Note: the APNs sender transport is still a stub (`lib/pushProvider.ts`), it must be built before push actually delivers. See `docs/IOS_APP_PRD.md` section 4.
- [ ] **Universal links (optional for v1):** add the Associated Domains capability `applinks:pubmaxxing.com`, and replace the `TEAMID` placeholder in `public/.well-known/apple-app-site-association` with the real Team ID.
- [ ] **Create the app record** in App Store Connect: name PUBMAXX, bundle id `com.pubmaxx.app`, primary language English (UK), category Food & Drink.
- [ ] **Paste metadata** from sections 1 to 5 of this doc. Upload screenshots from section 6.
- [ ] **Archive and upload** the first build: Xcode > Product > Archive > Distribute App > App Store Connect. This is the first step that needs the paid account.
- [ ] **TestFlight** internal test on your own device before submitting for review.
- [ ] **Submit for review.** Do not submit until the three native superpowers are demonstrably live (real camera, push delivery, universal links), or expect a thin-wrapper rejection. See `docs/IOS_APP_PRD.md` section 4 step 9.

### Google Play

- [ ] **Enrol** in the Google Play Console, 25 USD one-time, at play.google.com/console. Complete identity verification (can take a few days for individual accounts, start this early, it is the long pole).
- [ ] **Install Android Studio** (for the signing and bundle build), plus a JDK 17. Confirm `./gradlew` runs in `android/`.
- [ ] `npm ci` then `npx cap sync android`, then `npx cap open android` to open the project in Android Studio.
- [ ] **Upload key / signing:** opt into Play App Signing (recommended). Generate an upload keystore once (`keytool` or Android Studio > Generate Signed Bundle), keep it safe, it signs every future update. This is the one irreversible owner step, do not lose the keystore.
- [ ] **Build the release bundle:** Android Studio > Build > Generate Signed App Bundle (.aab), or `./gradlew bundleRelease`. Target SDK is already 36, which clears the Play target-API requirement.
- [ ] **Push (optional):** Firebase is required for Android push. Create a Firebase project, add an Android app with package `com.pubmaxx.app`, download `google-services.json` into `android/app/`. The Gradle file already applies the plugin only if that file is present, so nothing breaks until you add it.
- [ ] **Create the app** in the Play Console: name PUBMAXX, category Food & Drink, free.
- [ ] **Complete the Data safety form** and **content rating (IARC) questionnaire** from sections 4 and 5.
- [ ] **Set target audience** to 18 and over. Do not opt into Designed for Families.
- [ ] **Paste metadata** from sections 1 to 3. Upload screenshots and the 1024x500 feature graphic from section 6.
- [ ] **Upload the .aab** to the Internal testing track first, install on your own device, then promote to Production.
- [ ] **Roll out.** New personal Play accounts created after Nov 2023 also need a closed test with 12+ testers for 14 days before production, budget for that.

### Shared, not account-blocked

- [ ] **Publish a privacy policy page** at a stable URL (for example `https://pubmaxxing.com/privacy`) and use it in both listings. Both stores reject without it. This is the only non-account, non-code blocker, and it can be done now.
