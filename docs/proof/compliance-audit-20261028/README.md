# App compliance checks, 28 October 2026

Scope: the current UK-based operation. US DMCA and CAN-SPAM provisions are not treated as automatic UK launch requirements.

Continuation on 4 November 2026 integrates main `445df3a6` and preserves the original compliance commits.
Main now accepts a typed price without a receipt and labels it unchecked.
The adult check applies to both receipt-backed and unchecked prices. It does not change that evidence rule.
The route tests cover missing age, stored under-18 age and failed identity reads through both price paths.
Current integration checks remain pending. Counts below describe the earlier commits, not the integrated candidate.

The audit found an existing adult gate, self-hosted page fonts and disabled session replay.
It also found external map glyphs and incomplete marketing delivery. The copyright-report instructions now use a UK-focused process.
The local changes close an age-check gap in priced Pint Drops, require a digest postal address and improve the legal pages.

## Six requested checks

| Check | Evidence | Result and local change |
| --- | --- | --- |
| Missing age gate | `lib/adultGate.ts`, `lib/contributionIdentity.server.ts`, `lib/socialAccessServer.ts`, Pub Pal setup | Social, the main price form and pub photo walls already require an account's adult answer. Pub Pal setup asks for confirmation. The legacy priced Pint Drop endpoint skipped this check. Two real route tests reproduced HTTP 201 for an unanswered account and an under-18 account. It now refuses both, accepts a retry after a permitted adult assertion and refuses storage when the age read fails. Public map browsing and unpriced demo notes remain open. Self-assertion is not identity verification. |
| External fonts | `app/layout.tsx`, the installed Next.js font guide, live HTML, OpenFreeMap style response | Next.js self-hosts the page fonts. The home and terms documents contain no Google font origin. Map labels still load glyphs from `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`. The CARTO fallback also supplies external map resources. The privacy page now names map-label glyphs. This change does not remove those requests. |
| Session replay without consent | `lib/posthogClient.ts`, real SDK tests | Replay is disabled. Analytics starts only with consent. The real SDK tests cover consent changes and reject recorder loading and snapshot events. No other replay integration was found in application source or dependencies declared in `package.json`. Fresh deployed browser traffic remains unverified. |
| Marketing email footer | `lib/weeklyDigest.ts`, `lib/emailProvider.ts`, `scripts/send_weekly_digest.mjs` | The digest already required an unsubscribe URL. It lacked a postal address. `toEmailMessage` now requires a nonempty postal address and includes it safely in HTML and plain text. The shared Resend delivery provider is implemented. Digest audience loading and send orchestration remain incomplete. There is no active unsubscribe endpoint in this code. A syntactically valid URL does not prove unsubscribe works. |
| Renewal terms beside subscribe | App routes, components, dependencies and terms | No paid subscription checkout or paid subscribe button was found. Renewal disclosure is not applicable to the current product. No checkout or payment feature was added. |
| DMCA agent | `/terms` and public contact constants | A general contact address existed, but no agent designation was published. US DMCA agent registration is not a UK registration requirement. The terms now request the work, content URL, sender details, infringement explanation and authority to act. The US perjury declaration and signature requirement were removed. US designation remains a separate option if seeking US safe-harbour protection. Registration status was not verified. |

## Actions for the owner in the UK

1. Confirm the correct public trading name and business contact details. The current terms name Karan Manoharan as an individual in London.
2. Check the address disclosures that apply to the legal trading form. If operating through a limited company, include its required company details.
3. Supply the real postal address before using the existing digest builder. It remains a product safeguard, not a claim that PECR requires a postal address in every marketing email.
4. Before enabling consumer marketing, record consent unless a valid PECR exception applies. The current code uses explicit opt-in.
5. Keep marketing inactive until engineering tests an unsubscribe endpoint that works without sign-in and records suppression durably.
6. Check campaigns sent outside this repository. Their templates, audiences and historical sends were not available to this audit.
7. Monitor the published copyright-report inbox and respond to infringement reports.

## Optional US protections

DMCA agent registration and its renewal are outside the current UK action list. If seeking US safe-harbour protection, assess designation separately. Website contact details alone do not establish a US designation. CAN-SPAM duties require a separate applicability assessment for any US-facing marketing.

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
- Verification for the functional fixes passed: `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run verify` exited 0. This validates committed datasets without running the dataset builders.
- Unit coverage: 44,016 tests passed and one was skipped, across 2,133 passing files and one skipped file.
- Database permission checks: 697 tests passed across 75 files. The separate PostgreSQL cleanup proof passed all 10 tests.
- A separate final `npm run typecheck` passed. Changed files passed ESLint with no warnings. The full lint run retained three existing complexity warnings outside this change.
- The full check reported two advisory stale datasets, `area_news` and `google_places_content`, and three unmeasured store feeds. It did not report these as fresh.
- The vulnerability check reported no high or critical vulnerabilities.
- A final digest dry run sent nothing. Its message describes the inactive digest script, not the implemented shared Resend provider.

The UK scope correction changes the copyright copy and audit guidance. The legal-page suite and changed-file lint were rerun for that correction. The earlier full-suite counts above describe the functional-fix commit, not a new full run after the copy correction.

## Official references

- [ICO electronic marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/) explains consent and easy unsubscribe. It says unsubscribe should not require an account or sign-in.
- [UK copyright notice factors](https://www.legislation.gov.uk/uksi/2002/2013/regulation/22/data.xht) identifies sender details, content location and the alleged unlawful activity as relevant notice factors.
- [UK company disclosure guidance](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material) lists the details required from limited companies.
- [FTC CAN-SPAM guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) explains the postal address and opt-out duties for commercial email subject to US law.
- [Copyright Office DMCA directory](https://www.copyright.gov/dmca-directory/) explains the separate website publication and registration steps.
- [Copyright Office registration FAQ](https://www.copyright.gov/dmca-directory/faq.html) lists required contact details and renewal duties.
- [ICO storage and access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/) covers browser and app tracking technologies.

These sources cover different jurisdictions. The audit does not establish that every listed legal requirement applies to this London app.

## Review corrections, 4 November 2026

The managed review worktree replaces the Social-only recovery link with the shared age assertion in both composer states. The action works independently of Social access and requires an explicit price retry. Account changes invalidate old recovery actions and delayed replies. The four-case browser probe now disables Social access through an API double. Its browser execution remains pending.

The priced-write gate requests a strict assertion-store read for receipt-backed and unchecked prices. Missing-table and schema-cache failures refuse storage even when the account has an adult date of birth. Other read callers retain the existing fallback. The legal regression checks rendered terms and the rendered Drinkaware link.

The focused regression command ran against starting HEAD `fa8602f2af627e42b1e2af3d883a3b10fb17a69c` plus these review edits:

```sh
npm test -- __tests__/pintDrops.test.ts __tests__/pintDropPreviewLifetime.test.tsx __tests__/pintDropPriceFirstDoor.test.tsx __tests__/legalPages.test.ts __tests__/adultOnFile.test.ts __tests__/adultSelfAssertionRoute.test.ts __tests__/contributionGateDoor.test.tsx __tests__/contributionGateSurface.test.ts __tests__/contributionAuthProvider.test.ts
```

The final invocation exited 0 with 191 passing tests across nine files. The dependency freshness guard ran through the repository entry point. Two earlier invocations exited 1 while the new tests had incomplete database and notification doubles. The database double now permits the profile lookup before failing the assertion read. The notification double now answers the existing success notification. No application build, full verifier, lint phase or browser execution ran in this review phase. The browser probe still requires its allocated execution phase.

## Integration corrections, focused Test phase

Starting HEAD was `4ea2a455926c57fc2c9e53d8b0405923c6a316b8`. The following results include the uncommitted integration corrections.

Four mounted-component regressions reproduced stale refusal text after an account switch, with Social disabled.
They cover missing-age and under-18 refusals in both composer states.
The rendered legal-page regression also rejected the old photo-wall restriction.
The two-file reproduction command exited 1 with five failures:

```sh
npm test -- __tests__/pintDropPreviewLifetime.test.tsx __tests__/legalPages.test.ts
```

The hook now binds displayed age refusals to the submitting account revision.
Both legal notices describe posting restrictions and public photo reads.
The digest documentation distinguishes the implemented Resend provider from inactive digest orchestration.

The first post-fix invocation exited 1 because two older assertions could not accept the newly absent message.
Those assertions now require a null message after the account switch.
The same nine-file regression command listed above then exited 0 with 195 passing tests.
The dependency freshness guard ran normally.

The mounted-component tests use authentication and API doubles. They do not establish live account-switch or durable-storage acceptance.
Test-1 remains inconclusive until the later runtime booking.
No server, browser, application compiler, build, full verifier, lint, email send or pipeline control ran in this fix phase.
