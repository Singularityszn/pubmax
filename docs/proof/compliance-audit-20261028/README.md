# App compliance checks, 28 October 2026

The audit found an existing adult gate, self-hosted page fonts and disabled session replay.
It also found external map glyphs, incomplete marketing delivery and no published DMCA agent designation.
The local changes close an age-check gap in priced Pint Drops, require a digest postal address and improve the legal pages.

## Six requested checks

| Check | Evidence | Result and local change |
| --- | --- | --- |
| Missing age gate | `lib/adultGate.ts`, `lib/contributionIdentity.server.ts`, `lib/socialAccessServer.ts`, Pub Pal setup | Social, the main price form and pub photo walls already require an account's adult answer. Pub Pal setup asks for confirmation. The legacy priced Pint Drop endpoint skipped this check. Two real route tests reproduced HTTP 201 for an unanswered account and an under-18 account. It now refuses both, accepts a retry after a permitted adult assertion and refuses storage when the age read fails. Public map browsing and unpriced demo notes remain open. Self-assertion is not identity verification. |
| External fonts | `app/layout.tsx`, the installed Next.js font guide, live HTML, OpenFreeMap style response | Next.js self-hosts the page fonts. The home and terms documents contain no Google font origin. Map labels still load glyphs from `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`. The CARTO fallback also supplies external map resources. The privacy page now names map-label glyphs. This change does not remove those requests. |
| Session replay without consent | `lib/posthogClient.ts`, real SDK tests | Replay is disabled. Analytics starts only with consent. The real SDK tests cover consent changes and reject recorder loading and snapshot events. No other replay integration was found in application source or dependencies declared in `package.json`. Fresh deployed browser traffic remains unverified. |
| Marketing email footer | `lib/weeklyDigest.ts`, `lib/emailProvider.ts`, `scripts/send_weekly_digest.mjs` | The digest already required an unsubscribe URL. It lacked a postal address. `toEmailMessage` now requires a nonempty postal address and includes it safely in HTML and plain text. Delivery and audience loading remain stubs. There is no active unsubscribe endpoint in this code. A syntactically valid URL does not prove unsubscribe works. |
| Renewal terms beside subscribe | App routes, components, dependencies and terms | No paid subscription checkout or paid subscribe button was found. Renewal disclosure is not applicable to the current product. No checkout or payment feature was added. |
| DMCA agent | `/terms` and public contact constants | A general contact address existed, but no agent designation was published. The terms now explain how to send a copyright report, including the six notice elements. This does not appoint or register an agent. Copyright Office registration status was not verified. |

## Actions for the owner

1. Supply the real postal address to use in marketing email. Do not use the example fixture address.
2. Before enabling marketing, require recorded consent, a verified sender and a tested unsubscribe endpoint that works without sign-in.
3. Test that unsubscribe records durable suppression and excludes the recipient from the next mailing.
4. Check any campaigns sent outside this repository. Provider templates, existing audiences and historical sends were not available to this audit.
5. If seeking US DMCA safe-harbour protection, choose an agent and register the designation with the US Copyright Office.
6. Publish the same agent details on the site, including the agent's name, address, telephone number and email address.
7. Keep the registration current. The Copyright Office requires renewal within three years.

The app currently permits public browsing. A stricter site-wide age gate is a product decision, separate from the existing adult-feature checks.
Removing external map glyphs remains code work. It needs local font assets or a controlled first-party delivery path, followed by map-label browser checks.

## Evidence and limits

- Source base: `66a3db18770ab9551cf13679dccb5d6ce3a2ca99`.
- Live deployment during the HTTP check: `e5da6c072d378e8f94bfa8e841f805a801e697a3`. See `live-version.json`.
- Live home and terms documents returned successfully. The live OpenFreeMap Positron style declares the external glyph URL above.
- New email tests failed before the fix: the address was absent and missing addresses were accepted. All 32 digest tests passed after the fix.
- Targeted checks passed: 220 tests across nine files after the age fix. Separate checks cover the recovery links and related route behaviour. Three regenerated email-fixture tests also passed.
- The legal-page tests render server output. The PostHog boundary tests execute the installed SDK with a simulated transport.
- Browser checks could not run. The Playwright Chromium executable is absent, Chrome could not attach, and local browser use is disabled in Work settings.
- No application build, deployment, live migration or live email send was run.
- Final verification passed: `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run verify` exited 0. This validates committed datasets without running the dataset builders.
- Unit coverage: 44,016 tests passed and one was skipped, across 2,133 passing files and one skipped file.
- Database permission checks: 697 tests passed across 75 files. The separate PostgreSQL cleanup proof passed all 10 tests.
- A separate final `npm run typecheck` passed. Changed files passed ESLint with no warnings. The full lint run retained three existing complexity warnings outside this change.
- The full check reported two advisory stale datasets, `area_news` and `google_places_content`, and three unmeasured store feeds. It did not report these as fresh.
- The vulnerability check reported no high or critical vulnerabilities.
- A final digest dry run sent nothing. It reports that delivery remains unimplemented.

## Official references

- [ICO electronic marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/) explains consent and easy unsubscribe. It says unsubscribe should not require an account or sign-in.
- [FTC CAN-SPAM guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) explains the postal address and opt-out duties for commercial email subject to US law.
- [Copyright Office DMCA directory](https://www.copyright.gov/dmca-directory/) explains the separate website publication and registration steps.
- [Copyright Office registration FAQ](https://www.copyright.gov/dmca-directory/faq.html) lists required contact details and renewal duties.
- [ICO storage and access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/) covers browser and app tracking technologies.

These sources cover different jurisdictions. The audit does not establish that every listed legal requirement applies to this London app.
