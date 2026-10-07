# PUBMAXX Store Readiness Pack

**Status:** Everything on this page is pre-writable now, without an Apple or Google developer account. Sections 1 to 6 were audited on 4 September 2026 against the product on `main` and against the current App Store and Play rules; section 1 records what each store indexes, section 4 carries Apple's 2025 age-rating tiers rather than the retired 17+ one, and section 6 is the screenshot spec the iOS and Android workers render from. It is the copy, metadata, and answer sheet the owner pastes into App Store Connect and the Google Play Console once enrolment clears. Paid-account work includes enrolment, certificates, Sign in with Apple activation, and the first binary upload, listed as the owner checklist in the last section.

**App:** PUBMAXXING. Pint-price finder, crawl planner and night log, with the Pub Pal companion, wrapped in a Capacitor shell over `https://pubmaxxing.com` (see `docs/IOS_APP_PRD.md`, `docs/CAPACITOR_WRAP.md`).

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

The copy lives in `lib/storeListing.ts` with each store's character limit beside
it, and `__tests__/storeAssets.test.ts` holds every field to its limit and to
the rules below. Edit it there; this section is the paste sheet and the
reasoning.

**What each store actually indexes.** The two are not the same shape, and copy
written for one is wasted on the other.

| Field | Apple indexes it? | Google indexes it? |
| --- | --- | --- |
| App name / title | Yes | Yes, the strongest signal |
| Subtitle (Apple) | Yes | No such field |
| Short description (Google) | No such field | Yes |
| Keyword field (Apple, hidden) | Yes | No such field |
| Full description | **No** | **Yes, heavily** |
| Promotional text | No (Apple has said so) | No such field |
| Screenshot captions | **Yes, since June 2025** | No |

Three consequences the copy is built on. Apple's description is a CONVERSION
surface and buys no search term, so it is written for a reader. Google's full
description is the only indexed body it has, so the same text carries the terms
naturally rather than being kept short. And Apple reads the screenshot captions
now, which is why section 6 treats a caption as a keyword field with a picture
attached rather than as a slogan.

Keep the name clean and let the subtitle and keyword field carry the search
terms. Both stores penalise stuffing, and Apple bins duplicates between the
name, subtitle and keyword field.

**App name (30 char max, Apple / 30 char, Google):**
> PUBMAXXING

Ten of thirty characters, and deliberately no keyword bolted on. Google Play's
metadata policy says to avoid ALL CAPS "unless it is part of your brand name",
which this is (`lib/brandNaming.ts`), so the capitals are defensible if a
reviewer asks. Note what the name does NOT buy: Apple tokenises "pubmaxxing" as
one word, so "pub" and "pubs" are not free from it and the keyword field pays
for them.

**Subtitle (Apple, 30 char max):**
> Cheap pints near you, tonight

29 characters, and kept after this pass rather than churned. It is the only
visible indexed field the app has besides a brand name that carries no search
term, and it buys four things at once: the price posture (cheap), the drink
(pints), proximity (near you) and the occasion (tonight). Swapping "tonight"
for "london" was measured and rejected: London costs six characters in the
keyword field, tonight would cost seven.

**Promotional text (Apple, 170 char, editable without review):**
> Paid for a pint? Log what you paid, and the next drinker sees it. Nearest pubs, what a pint costs, what is on tonight, and a crawl route home. London prices, UK pubs.

166 characters. Apple has confirmed this field does not affect search, so it
spends nothing chasing a term and leads with the loop instead. It can be
changed without a review, so it is the right place to put whatever is true this
month.

**Keyword field (Apple, 100 BYTES, comma-separated, no space after the comma):**
> london,uk,pub,bar,crawl,beer,ale,lager,garden,price,drink,nightlife,happy,hour,finder,local,guide

97 bytes, seventeen words. The ceiling is bytes rather than characters, which
matters the day this is localised: a Japanese or Arabic keyword spends two or
three bytes on a character this English field spends one on.

Three rules produced that string, and `__tests__/storeAssets.test.ts` now holds
all three.

1. **Single words, not phrases.** Apple builds the combinations itself across
   the name, the subtitle and this field. The old string carried "pub crawl"
   and "pub finder", which spent the word "pub" twice for one indexed word.
   Seventeen words now reach every phrase the old eleven entries named, plus
   several they could not: beer garden, local pub, pub guide, London
   nightlife, UK pub crawl, happy hour prices.
2. **Nothing the name or the subtitle already earns.** Apple indexes both for
   free. "near me" used to sit here and spent five of its seven characters on a
   word "near you" had already bought. cheap, pint, near, you and tonight are
   deliberately absent for the same reason.
3. **No third-party marks.** A brewery or a chain is somebody else's trademark
   and Apple rejects a keyword field trading on one.

"taproom" left with the phrases. It is an American word for a room a British
drinker calls the pub; "local", "ale" and "lager" are what the same person
types.

**Google Play short description (80 char max):**
> London pub prices, the cheapest pint near you, and a crawl route home.

70 characters. Play indexes this one, so it is written to carry terms and still
read as a sentence a person would say.

**Primary ASO targets (the searches this listing is built to win):**
- london pubs / london pub guide
- pub crawl / uk pub crawl
- pint prices / pub prices / cheap pint
- pubs near me
- beer garden london
- happy hour london

**Levers this listing does not use yet**, listed so they are a decision rather
than an oversight. Apple custom product pages (up to 70, in organic search
since July 2025) and in-app events both feed search; Google Play custom store
listings and store listing experiments do the same. All four need a live
listing and install traffic, so they belong after the first release, not in the
submission pack.

---

## 2. Description

ONE body, taken by both stores. It used to be a short version and a long
version, which is two originals and therefore two things to keep true. Apple
does not index the description, so length costs nothing there; Google Play
indexes it heavily, so length is the only place several target terms can
honestly live. Both stores allow 4000 characters and this uses 2238.

It lives in `lib/storeListing.ts`. The text below is a copy for pasting, and
the module is what the test measures.

> PUBMAXX tells you what a pint costs before you walk in.
>
> You have left work. You want a decent pint that does not cost a fortune, somewhere close, without reading forty reviews first. PUBMAXX opens on the map, works out where you are, and puts the nearest pubs in front of you with the price we hold for each one. Ask for more than one and it lays out a crawl you can actually walk.
>
> Find a pint
>
> - The nearest London pubs, ranked by how far you actually have to walk.
> - Pint prices with the day we last saw them, so you know how fresh the number is.
> - Beer, wine, spirits, cocktails and no alcohol, each priced on its own.
> - Opening hours, so you do not arrive at a locked door.
>
> Log what you paid
>
> - Paid for a pint? Log the price. That is where these numbers come from, and it is how the cheap ones get found.
> - A price only moves the map once a second drinker confirms it, so one wrong figure cannot drag a pub up or down on its own.
> - The Pint Index publishes what London is charging, month by month, with the day each price was seen.
>
> Plan the night
>
> - Describe the outing and get a crawl route back in order, with the walking kept honest.
> - What is on tonight, from named sources, with the date we read them.
> - The last train, so the night has an ending you chose.
>
> Meet your Pub Pal
>
> - A companion who helps you find a pub, sort a plan and keep the night. Pick its form and give it a name. It is yours and it stays on your account.
>
> Straight answers on prices
>
> Pubs change their prices and we are not standing at the bar. We show the best figure we have and when we last saw it. Treat it as a steer, not a promise.
>
> Privacy
>
> Full GPS precision stays on your phone. Ask for something nearby and the app sends a rounded point for that one request. Analytics stay off until you turn them on. There are no adverts, and nothing is sold on. A photo is public only where you post it: a pub wall and the feed are public by design, and a Moment stays on your phone until you publish it.
>
> Where it works
>
> Pubs across the UK are on the map. Pint prices are London for now, because a price is only worth showing once drinkers here have checked it. Other cities follow the same way.
>
> PUBMAXX is free. You do not need an account to find a pint.

### What this pass changed, and why

Every line is a claim a reviewer can open the app and check, so the audit was
run against the product on `main` rather than against the previous draft.

- **"Last orders" is gone.** It sat in both old versions for a month and the
  app has never held a last-orders time for any pub. The only "last orders"
  string in the tree is the 404 joke. `__tests__/storeAssets.test.ts` now fails
  if it comes back. What the app does hold is the last train
  (`lib/lastTrainBadge.ts`), and that is what the copy says.
- **The price loop is in it.** The landing page's one primary action is "Log
  what you paid" (`docs/design/LAUNCH_SCREENS.md`), and the old copy never
  mentioned that a drinker logs the prices or that a second drinker confirms
  them before the map moves. That is the differentiator against every general
  map app, and it was missing from the listing entirely.
- **Pub Pal is in it.** It is a first-class surface (`/pal`, `/pal/chat`), the
  landing page's secondary action, and seven rendered forms as of #1449. The
  old copy did not mention it.
- **"London only for now" became precise.** Ten cities browse
  (`lib/cities.ts`) and the UK base pub layer covers the country, while pint
  prices really are London only (`lib/cityCapabilities.ts` answers
  `PRICES_NOT_YET_COLLECTED` for every other city). Saying so exactly is both
  more honest and worth the UK search terms.
- **"Not a feed for strangers" is gone.** Section 5 of this document answers
  Google Play's data safety form with photos SHARED, because a pub wall photo
  is public by design. The description denied that in the same submission. The
  new privacy paragraph says which surfaces are public and which are not.
- **No metric, no user count, no award.** There is nothing to count yet, and a
  number in a listing rots the day after it is pasted.

---

## 3. Category and content

- **Primary category:** Food & Drink (both stores).
- **Secondary category (Apple, optional):** Travel or Lifestyle. Travel fits the "near me while out" use better.
- **Google Play category:** Food & Drink.
- **Google Play tags:** a separate field from the category, up to five, chosen from Google's own closed list rather than typed. Pick the ones that exist for Food & Drink and, where the list offers them, the map or nightlife adjacent ones. Tags feed browse and recommendation, not text search, so nothing in section 1 depends on them.
- **Contains ads:** No.
- **In-app purchases:** No.
- **Price:** Free. Note that "free" belongs in the description, never the title: Google Play's metadata policy bars pricing and promotional claims from the title.

---

## 4. Age rating

The app is about pubs, beer and pint prices. Alcohol is the subject, not an
incidental mention, so answer the alcohol questions as frequent and central. Do
not undersell this: an under-rating is a takedown risk.

### Apple App Store (App Store Connect questionnaire)

**Apple replaced its tiers in 2025, and 17+ no longer exists.** The bands are
now 4+, 9+, 13+, 16+ and 18+; 12+ and 17+ were removed and every existing app
was reassigned. The questionnaire also grew a set of mandatory capability and
in-app control questions that the old draft of this section predates. Expect
the form to look nothing like the 2024 one.

Answer as follows. Everything not listed is None / No.

| Question | Answer |
| --- | --- |
| Alcohol, Tobacco, or Drug Use or References | **Frequent** |
| Contests | None |
| Gambling | No (no real or simulated gambling) |
| Horror/Fear, Violence (all kinds) | None |
| Sexual Content or Nudity, Profanity, Crude Humor | None |
| Mature/Suggestive Themes | None |
| Medical or Wellness content | None |
| **Capability: Unrestricted Web Access** | **Yes** (the shell loads a live website in a web view) |
| **Capability: User-Generated Content** | **Yes** (Social, Visit Reports, community prices, pub photo walls, the Drink Wall, Moments) |
| **Capability: Social Media** | **Yes** (`/social`, follows, public feed) |
| **Capability: Messaging and Chat** | **Yes** (`/messages`, a one-to-one thread with photo and pub attachments) |
| **Capability: Advertising** | No |
| In-app control: Parental Controls | None |
| In-app control: Age Assurance | The app takes every account to be an adult on one recorded tap (`accountIsAdult`, `lib/socialLaunch.ts`). Declare it as the self-assertion it is, not as verification. |
| Made for Kids | No |

**Expected result: 18+.** Frequent alcohol references alone produce 18+.
Unrestricted Web Access produces 16+ on its own, so it is not what drives the
band here, but it is a true answer and must be given.

Declaring user-generated content, social media and messaging is not optional
and it carries a duty: the submitted build must ship working reporting,
moderation, blocking, account deletion and a public support contact. All five
exist (`lib/siteContact.mjs` owns the address); make sure a reviewer can reach
each one without an account where the surface allows it. The support mailbox
itself must answer before submission: see section 8, "Before either store".

### Google Play (IARC questionnaire)

| Question | Answer |
| --- | --- |
| App category | Reference, News, or Educational / Utility. Choose the closest, then answer content questions honestly. |
| Does the app contain references to alcohol, tobacco, or drugs? | **Yes, references to alcohol** (finding and pricing alcoholic drinks is the core function) |
| Promotes or facilitates the purchase of alcohol? | No (we do not sell or take orders) |
| Gambling, violence, sexual content, language | No / None |
| Does the app share the user's location with other users? | No |
| Users interact / share content? | **Yes.** Social, Messages, Visit Reports, community prices, venue reports, recommendations and public Moments can carry user content. Reporting, moderation, blocking, account deletion and the public support contact must work in the submitted build. |

The IARC questionnaire produces its own bands per region and this pack does not
predict them: it is a certificate issued by the rating bodies, not a value we
choose, and guessing it here would be a claim we cannot keep. What IS ours to
set is **target audience in the Play Console: 18 and over**. Do not select any
age band under 18 and do not opt into the Designed for Families or Teacher
Approved programmes.

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
| Photos | Only when the user chooses to publish one. Moment drafts stay on the phone. FOUR surfaces take a photo: a Moment, a pub photo wall, the Drink Wall (`/wall`), and an optional photo on a logged price. | Tied to that content only, not to a real-world identity | No | User content | `lib/momentDraft.ts` keeps Moment drafts in IndexedDB/localStorage on the device; `lib/nightMomentMedia.ts` uploads on publish. Camera access is `lib/nativeCamera.ts`, declared as usage strings in `ios/App/App/Info.plist` and as `CAMERA` plus `READ_MEDIA_IMAGES` in `android/app/src/main/AndroidManifest.xml`. |
| Email address | Only if the user signs in, or asks us to cover an area they name | Yes (it is the contact) | No | Account sign-in, and telling one person we reached the area they asked for | Sign-in is a Supabase magic link (`components/auth/AuthProvider.tsx`); the optional area-demand contact is `app/api/area-demand/route.ts` (most rows carry no address at all). There is no marketing list and no digest capture (`docs/EMAIL_CAPTURE.md`). |
| Audio (voice) | Only while the user talks to Pub Pal by voice. The microphone streams to ElevenLabs (`api.elevenlabs.io`) for that conversation. PUBMAXXING stores no audio. ElevenLabs keeps it under its own default retention: the voice-token API answers `retention: "provider_default"`. Confirm the ElevenLabs retention settings before either store form is submitted. | Yes (it belongs to the signed-in conversation) | No | App functionality | `components/pubpal/PubPalVoiceSession.tsx` is the only module that imports the ElevenLabs SDK. The microphone is declared as `NSMicrophoneUsageDescription` in `ios/App/App/Info.plist` and as `RECORD_AUDIO` in `android/app/src/main/AndroidManifest.xml`. `app/api/pub-pal/voice-token/route.ts` returns `retention: "provider_default"`. `app/privacy/page.tsx` names ElevenLabs under AI features. |

### What the app does not do

- No advertising SDKs, no ad identifiers, no cross-app tracking. Nothing on this list is used to track the user across other companies' apps or sites.
- No selling or sharing of personal data with data brokers.
- No account required to find a pint. Identity is optional and prompted contextually, not at launch.
- No background location access. Full-precision viewer coordinates stay on the device. Rounded coordinates are not shown to other users and are used only to answer a location request.

### Apple App Privacy label (App Store Connect > App Privacy)

Declare the following. Everything else: Not Collected.

- **Data Used to Track You:** None.
- **Data Linked to You:** Contact Info > Email Address (account sign-in or optional area-demand contact), purpose App Functionality. User Content > Photos or Videos (a published Moment, a pub wall or Drink Wall photo, or a photo on a logged price), purpose App Functionality. User Content > Audio Data (Pub Pal voice, streamed to ElevenLabs, which keeps it under its default retention), purpose App Functionality.
- **Data Not Linked to You:** Identifiers > Device ID (push token), purpose App Functionality. Usage Data > Product Interaction (opt-in analytics), purpose Analytics. Precise Location, purpose App Functionality, only when the user starts a location feature.
- **Location processing:** declare Precise Location because three decimal places is about 70 to 110 metres. Mark it optional, not linked, not used for tracking, and used for App Functionality. The app processes the rounded point ephemerally. Confirm current processor retention terms in App Store Connect before submission.

### Google Play Data safety form

- **Does your app collect or share any of the required user data types?** Yes.
- **Precise location:** Collected, optional, processed ephemerally, purpose App functionality, not used for tracking. Full GPS precision stays on the device; only the three-decimal point leaves it. In the Data safety flow, identify the ephemeral processing and current service-provider or user-initiated transfers exactly as the form asks.
- **Personal info > Email address:** Collected, not shared, optional, purpose App functionality. Encrypted in transit. Account deletion removes the sign-in address; other erasure requests use the public contact in `lib/siteContact.mjs`.
- **Photos and videos:** Collected, purpose App functionality. Answer **shared: yes** for pub wall and Drink Wall photos. A wall photo is PUBLIC by design: it appears on that pub's page and on `/wall` when it is in the city grid, and the pub-wall composer offers a crosspost to the public feed. Saying "not shared publicly by default" would be a wrong answer on the form, not a cautious one. Moment drafts stay on the device and are collected only on publish.
- **Audio > Voice or sound recordings:** Collected, not shared, optional, purpose App functionality. Pub Pal voice streams the microphone to ElevenLabs as a service provider while the user talks to it. PUBMAXXING stores no audio, but ElevenLabs keeps it under its default retention (`provider_default`). Do not answer "processed ephemerally" unless the ElevenLabs settings are confirmed to keep nothing before submission.
- **App activity > Product interaction:** Collected, not shared, optional (opt-in), purpose Analytics. Encrypted in transit.
- **Device or other IDs:** Collected (push token), not shared, purpose App functionality.
- **Is all data encrypted in transit?** Yes (HTTPS only, the shell loads `https://pubmaxxing.com`).
- **Can users request data deletion?** Yes. Account deletion covers account-linked data, including Night Memories and their Moment photos; the public contact in `lib/siteContact.mjs` handles other requests, including an optional area-demand address.

**Privacy policy URL:** required by both stores. Use `https://pubmaxxing.com/privacy`. The site publishes it (with `/terms`) from `app/privacy` / `app/terms`; see the AGENTS.md privacy-notice entry for the keep-it-honest rule.

**Account deletion URL:** required by Play's Data safety form, which asks for a page anybody can open WITHOUT signing in. Use `https://pubmaxxing.com/account/delete` (`app/account/delete/page.tsx`). It describes the in-app path and does not offer a second delete door: a deletion control a stranger can reach is an account-takeover surface however it is worded.

**What a deletion keeps, and both stores are told plainly:** we keep the prices, and we remember these accounts and what they logged, so a departed account's contributions stay up with the handle taken off them while a private ledger only we can read (`public.account_retention_ledger`, migration `0150`) records which deleted account logged which of them. Answer Play's "Can users request data deletion?" and Apple's account-deletion review question with that sentence, because a reviewer who reads `/privacy` and then finds a public price still on a pub's sheet is owed the reason in advance.

**Where the in-app door is:** You tab, Account settings, **Delete account**, then **Delete my account**. It is `components/profile/DeleteAccountCard.tsx` calling `DELETE /api/account`, which removes the caller's own photos through the Storage API, deletes the caller's own `auth.users` row and lets migration `0078`'s trigger (as restated by `0145`) do the rest. The words on the confirm step and on the public page are the same constants (`lib/accountDeletion.ts`), so the two cannot promise different things. A reviewer probing the account flow finds it in three taps from the tab bar.

---

## 6. Screenshot shot list

This section is the SPEC. The executable half is the `SHOTS` array in
`scripts/gen-store-screenshots.mjs`, and the shipped half is
`public/store-assets/screenshots/<size>/manifest.json`. The iOS and Android
workers own the generator and the render; this section is what they render.

**The two halves had drifted.** Before this pass the doc named `/near`, `/feed`
and `/u/you` as shots 2, 5 and 6, and the generator has been shipping
`/borough/hackney`, `/pint-index` and `/plan` in those slots. The table below is
the generator's truth. Any row marked **change requested** is a spec delta for
the owning worker to apply to `SHOTS`; nothing else in this section is a
request.

### How the set is made

The set is GENERATED from the real screens, not cropped from an old QA run.
**Shoot the production site**, because the shell is a remote-URL wrap of it: a
person who installs the app sees pubmaxxing.com, so that is the app the listing
has to show.

```
BASE=https://pubmaxxing.com npm run gen:store-screenshots
```

A local build works too, and is the right target when a screen is changing and
has not shipped yet. It is not the right target for the upload: a keyless local
server has no listings provider, so the Tonight shot comes out carrying "Could
not reach tonight's listings" and a Retry button.

```
NEXT_DIST_DIR=.next-prod DEPLOYMENT_VERSION=$(git rev-parse HEAD) npm run build
NEXT_DIST_DIR=.next-prod DEPLOYMENT_VERSION=$(git rev-parse HEAD) PORT=3100 npm start
BASE=http://localhost:3100 npm run gen:store-screenshots
```

Output is `public/store-assets/screenshots/<size>/`, one folder per store size,
each with its shots and a `manifest.json` carrying the caption to paste beside
each one. `__tests__/storeAssets.test.ts` reads the PNG headers, so a shot at
the wrong pixel size fails rather than being discovered in the upload form.

Two things the generator refuses on purpose. It will not shoot a `next dev`
server, because the dev overlay badge paints straight onto the phone tab bar.
And it renders each size at its own device viewport rather than upscaling one
frame, because an upscaled 430-wide shot is what makes a listing look like a
photographed website.

Two first-run cards are ANSWERED before each page loads rather than hidden
afterwards: the analytics disclosure, and the map's first-visit location card,
which otherwise covers the bottom third of the lead shot with a permission ask.
Both are right in the app and neither is the app. The analytics answer is
`denied`, so a production run adds no robot page views to the real numbers. If
either storage key is renamed, the run fails loudly rather than shipping the
card.

### A caption is an indexed field now

Apple began extracting screenshot caption text for search in June 2025. A
caption is therefore a keyword field with a picture attached, not a slogan, and
the rules are the ones a keyword field has: carry a term a person types, do not
repeat a word the subtitle already earns for free, and stay readable at store
size. Google does not index captions, so the same caption serves both and is
written for Apple.

Captions stay in the manifest rather than being painted into the PNG. A baked
caption cannot be corrected or localised without a re-render, and a term Apple
reads off a picture is worth less than one it reads off a field.

### The shot list

Order matters more than count. Roughly 90% of App Store impressions never
scroll past the third shot, so the first three carry the listing.

| # | Route | Caption | Job |
| --- | --- | --- | --- |
| 1 | `/map` | London pubs on the map. | Hero. The core promise, and the one screen that says at a glance what the app is. |
| 2 | `/borough/hackney` | What a pint actually costs. | The proof. A borough rather than `/near`, because the caption promises prices and `/near` before a location grant has none to show. |
| 3 | `/crawls` | A crawl you can walk. | The differentiator, and the reason someone keeps the app. |
| 4 | `/tonight` | What is on across London tonight. | Recurring use. |
| 5 | `/pint-index` | Pint prices, month by month. | The receipt. Nobody else publishes this. |
| 6 | `/plan` | Describe the outing. Get it in order. | The planner, in the words the screen itself uses. |

**Change requested, for the worker who owns `SHOTS`:**

- Shot 3 caption: "A crawl you can actually walk." to "A crawl you can walk."
  Shot 2 already says "actually" and two captions in a row leaning on the same
  word reads as one voice tic rather than two claims.
- Shot 6 caption: "Describe the night. Get it in order." to "Describe the
  outing. Get it in order." The screen's own heading is "Describe the outing.
  We'll put it in order." (`docs/design/LAUNCH_SCREENS.md`), and a caption that
  paraphrases the screen it sits beside is a small lie a reviewer can see.
- **Add a seventh shot: `/pal`, caption "Your Pub Pal knows the round."** Pub
  Pal is the landing page's secondary action and seven rendered forms as of
  #1449, and the listing currently shows none of it. Play takes eight
  screenshots, so seven fits both stores. Put it at position 7 rather than
  higher: the price argument has to land first.

Any caption change must also be made in the description or the promotional text
if it contradicts them, and `__tests__/storeAssets.test.ts` holds every size to
the same shot list, so the three manifests cannot disagree.

### Required device sizes

**Apple.** The requirement changed and this pack predated it. There is now ONE
required iPhone class, and App Store Connect scales it down for the rest:

- **6.9" is the required class.** It accepts 1320x2868, 1290x2796 and
  1260x2736. The generated `ios-6.7` set is 1290x2796, which is inside that
  class and is accepted as it stands, so nothing is blocking. The folder name
  is stale, not the pixels.
- **6.5" is a fallback, not a requirement.** It accepts 1284x2778 and
  1242x2688. The generated `ios-6.5` set is 1242x2688 and is fine to upload,
  but supplying it is now optional.
- iPad screenshots are needed only if the app is offered on iPad. Otherwise set
  availability to iPhone only.
- Up to 10 per size. No alpha channel.

*Worth doing, not blocking:* rendering the 6.9" set natively at 1320x2868 would
be sharper than letting Apple scale 1290x2796 up on a 17 Pro Max. That is a
generator change (`REQUIRED_SIZES` in `__tests__/storeAssets.test.ts` pins the
current pair) and belongs to the iOS worker, not to this pass.

**Google Play.** Minimum two, maximum **eight** phone screenshots, 16:9 or 9:16,
minimum 320px and maximum 3840px on any side, PNG or JPEG with no alpha. The
generated `play-phone` set is 1080x1920. A feature graphic at exactly 1024x500
is also required.

**Preview video: neither store has one, and that is a deliberate deferral.** An
App Store preview autoplays muted in search and is the single largest
conversion lever left on this listing. A Play video does not autoplay and only
about 6% of visitors tap it, so Play's is worth far less. Neither is a
submission blocker. Do the iOS one after the first release, when there is a
build to record rather than a website to film.

**Feature graphic (Google Play, 1024x500):** DONE and committed at
`public/store-assets/png/play/feature-graphic-1024x500.png`. Ink-deep field
(`#060607`), the coral double-struck X read from the one geometry master,
wordmark "PUBMAXX" and tagline "Cheap pints near you." Text is fine here; the
no-text rule applies to the icon and the splash, which are masked and shown at
20px.

It is the one store asset NOT drawn from an SVG master, and that is deliberate.
librsvg resolves `font-family` through the machine's own font stack, so an SVG
master asking for Space Grotesk renders in whatever face happens to be
installed and says nothing about having done so. The banner is rendered by the
same satori path the OG cards use (`scripts/gen-store-assets.mjs`), which is
handed the repo's own font file. Do not reintroduce an SVG master for it;
`__tests__/storeAssets.test.ts` fails if one appears.

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

Coral `#ff5a5f` on a white `#ffffff` tile measures ~3.7:1 contrast, comfortably above the 3:1 large-graphic threshold and crisper on a home screen than the retired coral-on-ink treatment. The full double-struck X holds at 40px+, but its two thin ascending strokes (~4u channel) merge below ~24px, so the ≤64px small-optics master takes the single-slash `slashSimple` + thick descending stroke instead: one clean forward slash that stays legible at the 20px slot. No ember at any tier (the crossing is already the event). Verified by sampling rendered pixels on the 29px, 512px and 1024px exports (white field, coral stroke).

### Wiring into the native shells (when syncing)

- **iOS:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/` uses a single universal 1024 (`AppIcon-512@2x.png`), and it already IS `png/ios/AppIcon-1024.png` byte for byte. The full classic slot set exists for older Xcode setups and App Store Connect uploads.
- **Android / Play:** upload `play-store-512.png` in the Play Console; the adaptive layers feed `@capacitor/assets` (or hand-placed `mipmap` resources) at sync time.
- **Capacitor splash:** feed `splash/splash-2732.png` as both `splash` and `splash-dark` sources, the ink-dark art is the same for both (the splash keeps the ink field even though the icon is now a white tile), then `npx @capacitor/assets@3 generate` (fetched ephemerally, see the header of `scripts/gen-native-app-icons.mjs` for the npm-audit rationale).

### Manual export fallback (no sharp)

`scripts/gen-store-assets.mjs` needs the `sharp` package (already a dependency). If it cannot load in some environment, do not add a new raster dependency: open each SVG master in any renderer (`rsvg-convert -w <size> -h <size>`, Inkscape, Figma) and export the table above, using `icon-square-small.svg` for sizes at or under 64px and stripping alpha on the iOS set.

---

## Local verification (no store account)

Everything in section 8 needs an account. Neither shell below does, and they are
the check to run before touching any of it: they prove each shell compiles and
boots. This section is deliberately unnumbered so section 8 keeps the number
every other document cites it by.

### iOS (no Apple account)

```sh
npm ci
npm run ios:build     # cap sync ios, then build the App scheme for the simulator SDK
npm run ios:run       # the same build, then boot a simulator, install and launch
```

Both are `scripts/ios-simulator.mjs`. `ios:run` picks the newest available
iPhone simulator, or takes one by name (`PUBMAX_IOS_SIMULATOR="iPhone 17"`), and
finishes by printing the `xcrun simctl io <udid> screenshot shot.png` line for
the device it used.

*Done when:* `** BUILD SUCCEEDED **`, and the launched app lands on the native
first-run onboarding, which only the shell shows. That screen is the proof the
WKWebView reached `https://pubmaxxing.com` and that `isNativeApp()` answers true
inside it. With no network the shell serves the bundled `offline.html` instead,
which is the wrap working rather than a build fault.

Three things this check cannot prove, each of them a device step in section 8:
the entitlements (a team-less build signs to run locally and writes an EMPTY
entitlements file, so the built app carries neither push nor associated domains
however correct `App.entitlements` is), the camera sheet, and push delivery.

Evidence from the runs that landed these scripts is in
`docs/proof/ios-shell-build/`.

### Android (no Play account)

```sh
npm ci
npm run android:build   # cap sync android, assembleDebug, then testDebugUnitTest
npm run android:run     # boot a headless emulator, install, launch, screenshot
```

`npm ci` stays a separate step because `android:build` runs FROM npm, so
reinstalling would delete `node_modules` under the process running it. The APK
lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

Both scripts resolve the toolchain themselves (`scripts/android/toolchain.mjs`)
and refuse BY NAME when a piece is missing, rather than letting Gradle fail deep
inside a task about a path:

| Value | Default it looks for | Override |
| --- | --- | --- |
| `JAVA_HOME` | `/opt/homebrew/opt/openjdk@21`, either the `libexec/openjdk.jdk/Contents/Home` layout or whatever that keg's own `java` reports as `java.home` | export `JAVA_HOME` |
| `ANDROID_HOME` | `/opt/homebrew/share/android-commandlinetools` | export `ANDROID_HOME` or `ANDROID_SDK_ROOT` |
| AVD | `pubmaxx`, created from the system image matching `compileSdkVersion` in `android/variables.gradle` if it is not there | `PUBMAX_ANDROID_AVD` |

JDK 21 is the floor, because Android Gradle Plugin 8.13 needs it. The SDK
packages are the ones section 8 step 2 installs, plus the emulator and one
system image:

```sh
sdkmanager --install "platform-tools" "emulator" \
  "platforms;android-36" "build-tools;36.0.0" \
  "system-images;android-36;google_apis;arm64-v8a"
```

*Done when:* `BUILD SUCCESSFUL`, and the launched app lands on a page of the
live site. The shell is remote-URL mode, so a healthy first screen IS
`https://pubmaxxing.com` rendered in the WebView rather than a bundled page;
`native/web-stub/offline.html` is what appears instead when the main frame
cannot reach production. `android:run` writes the shot to
`android/build/emulator/first-screen.png`, and `--out <path>` moves it.

Two lifecycle lines print on every build and both are true and expected on a
machine with no owner secrets: `keystore.properties` is absent, so a release
build would be unsigned, and `google-services.json` is absent, so push will not
register. Neither stops a debug build, and section 8 fixes both.

Two traps `android:run` already handles, both of them ways a screenshot can be
filed as evidence about the app while showing something else. Under
`swiftshader_indirect` SystemUI is slow enough to hit its own ANR, and that
dialog takes the focused window over a perfectly healthy app, so the script
waits for the window manager to name OUR activity and relaunches if something
else holds the window. Holding the window is still not a settled screen: a shot
taken ten seconds after focus caught white status-bar icons over the light page
and read as a contrast bug, and the same device painted them correctly a minute
later with nothing touched.

Not provable on an emulator, and therefore device steps in section 8: push
delivery, App Links verification, and the camera sheet.

Evidence from the run that landed these scripts is in
`docs/proof/android-shell-build/`.

---

## 8. Owner-only remaining steps

Everything above is done or ready to paste. The steps below need a real account, real money, or a physical signing step, and only the owner can do them. Nothing here is blocked by the codebase.

### Before either store: the support mailbox must answer

The site's one public contact address is `CONTACT_EMAIL` in
`lib/siteContact.mjs`, which `lib/siteContact.ts` re-exports for the app and the
crawler scripts read for their user-agent headers. The address is
`karan@pubmaxxing.com` (the captain's word, 15 September 2026; it replaced
`support@pubmaxxing.com`). The captain owns this step: confirm it is a real
inbox, or a forwarder to an address he reads every day.

Do it before either submission. Both stores require a working public support
contact for an app that declares user content, and `/privacy`, `/terms`,
`/about` and `/account/delete` print this address to strangers today. A privacy
notice that names an inbox nobody reads is worse than no address at all.

*Done when:* a message sent to `karan@pubmaxxing.com` from an outside address
arrives, and a reply sent from it is delivered.

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

A fresh Xcode carries no iOS runtime, so install one first. It is several GB
and only needed once.

```sh
xcrun simctl list runtimes                 # empty means download it
xcodebuild -downloadPlatform iOS
xcrun simctl list devices available | grep iPhone
```

Then build against a device name that run actually printed:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

*Done when:* `** BUILD SUCCEEDED **`, and the app opens pubmaxxing.com after
`xcrun simctl install booted <path>/App.app` and
`xcrun simctl launch booted com.pubmaxx.app`. It opens on the native first-run
onboarding, which only the shell shows, so seeing it proves `isNativeApp()` is
true inside the WebView.

**A GREEN SIMULATOR BUILD DOES NOT PROVE THE ENTITLEMENTS.** With no team set,
Xcode signs to run locally and writes an EMPTY entitlements file, so the built
app carries neither push nor associated domains however correct
`App.entitlements` is. `CODE_SIGN_ENTITLEMENTS` is still resolving; confirm
that with `xcodebuild -showBuildSettings | grep CODE_SIGN_ENTITLEMENTS` rather
than by inspecting the built binary. Step 6 after the team is set, and step 10
on a device, are what actually prove them.

The simulator also has no camera and cannot receive push. `xcrun simctl push`
delivers nothing visible until notification permission has been granted inside
the app, which needs a real tap. Both belong to step 10.

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

**Launch coral, on the same iPhone.** Delete the app, install it, and launch it
once. Close it, then launch it again: this second launch draws from the
snapshot iOS cached after the first. On both launches, compare the coral mark
with the splash that follows it. They must be one colour. The simulator shows
the cached snapshot more saturated than the brand coral, although the asset and
the stored snapshot are both brand-exact (`docs/CAPACITOR_WRAP.md`, "Cold
start"). If the iPhone shows the same shift, write it down beside this step;
do not retouch the launch image to compensate.

*Done when:* all three work on the device, not the simulator. Section 8 of this
document and `docs/IOS_APP_PRD.md` section 4 step 9 both hold the app to this
before submission.

**11. Create the app record in App Store Connect: name PUBMAXXING.**
Go to <https://appstoreconnect.apple.com/apps>, then the plus button, then New
App. Bundle id `com.pubmaxx.app`. Primary language English (UK). Category Food
& Drink. SKU `pubmaxxing-ios`.
*Done when:* the app appears with status *Prepare for Submission*.

**12. Paste the metadata and upload the screenshots.**
Sections 1 to 3 hold the name, subtitle, keywords and the one description both
stores take. Section 4 holds the age rating answers, which are the 2025
questionnaire rather than the one this pack was first written against. Section
5 holds every App Privacy answer.

The screenshots are already rendered in
`public/store-assets/screenshots/ios-6.7/` (1290x2796, inside Apple's required
6.9" class) and `public/store-assets/screenshots/ios-6.5/` (1242x2688, the
optional fallback class). Each folder's `manifest.json` carries the caption for
each shot, and the caption is now an indexed field, so paste it rather than
leaving the slot blank. Only the first set is required; upload the second only
if you want native pixels on an older device.
*Done when:* App Privacy and the age rating show no outstanding questions, and
the 6.9" set is uploaded with a caption on every shot.

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
- **Audio > Voice or sound recordings:** collected, not shared. Optional.
  Purpose: App functionality. Pub Pal voice streams the microphone to
  ElevenLabs as a service provider. PUBMAXXING stores no audio, but ElevenLabs
  keeps it under its default retention (`provider_default`). Confirm the
  ElevenLabs retention settings first, and do not tick "processed ephemerally"
  unless they keep nothing.
- **App activity > App interactions:** collected, not shared. Optional, because
  analytics are opt-in and default off. Purpose: Analytics.
- **Device or other IDs:** collected, not shared. Purpose: App functionality
  (the push token, stored with no identity column).
- Everything else on the form: **not collected**.
- Privacy policy URL: `https://pubmaxxing.com/privacy`

**11. Store listing.** The app name and short description are section 1; the
full description is section 2. Upload from this repository:

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
the browser. Finally, prove the email, Google, Apple and Microsoft sign-in callbacks return
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

- [x] **Publish a privacy policy page**. Done: `https://pubmaxxing.com/privacy` (and `/terms`) ship from `app/privacy` / `app/terms`, linked in the site footer. Use that URL in both listings.
