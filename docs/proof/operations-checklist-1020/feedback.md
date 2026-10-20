# Feedback implementation proof

Date: 20 October 2026.

Source base: `184eabedd59f91f399f458e8413577a936f263a1`.
Commit: `0dff4d4ee9291e25fe101d3fd8a5292909f6e0ad`.
Branch: `agent/in-app-feedback-1020`.
Worktree: `/Users/karanmanoharan/.codex/worktrees/in-app-feedback-1020/pubmaxx`.

## Behaviour

The account support row now offers Send feedback to signed-out and signed-in readers. It opens the public `/feedback` page. The page has one email-draft action and a selectable address fallback. Its mailto target reads the existing CONTACT_MAILTO constant. It adds only the subject `PUBMAXX feedback`. It accepts no page, account, location or query context. The user writes and sends the message in their email service.

The account row also links to `/updates`. The parent task owns that page.

## Before and after

- `before-account.yml` and `before-account-mobile.png`: signed-out `/u/you`, 390 by 844. The support region exists. It contains zero feedback links.
- `after-account.yml` and `after-account-mobile.png`: signed-out account support region with Send feedback and Updates links.
- `after-feedback-mobile.yml` and `after-feedback-mobile.png`: navigation through Send feedback, 390 by 844, light theme.
- `after-feedback-mobile-dark.png`: 390 by 844, dark theme.
- `after-feedback-desktop.png`: 1440 by 900, light theme.
- `after-feedback-desktop-dark.png`: 1440 by 900, dark theme.

The CLI browser performed the account-to-feedback-to-account path. The draft action received focus. Enter activated it with the external-mail default prevented by the test. The page remained available. The fallback address was selected successfully. No email client opened and no mail was sent.

## Checks

Fresh dependencies: `npm ci --no-audit --no-fund`, 731 packages installed. Node v26.10.0 and npm 12.2.0.

The first rendered account-link test failed because the feedback link was missing. It passed after the link was added. The page target test then failed because the public page was absent. It passed after page implementation.

Passed:

1. `npx vitest run __tests__/feedback.test.tsx __tests__/accountSurfaceStoreDoors.test.tsx __tests__/pubmaxxAccountHub.test.ts __tests__/launchPrimitives.test.tsx __tests__/designTokens.test.ts __tests__/emDashLaw.test.ts __tests__/templatePatterns.test.ts`: 7 files, 64 tests.
2. `npx eslint app/feedback/page.tsx components/profile/AccountLegalRow.tsx __tests__/feedback.test.tsx e2e/feedback.spec.ts`: exit 0.
3. `NEXT_DIST_DIR=.next-feedback npm run typecheck`: exit 0.
4. `PW_PORT=43312 PW_SKIP_WEBSERVER=1 PW_SKIP_KEYLESS_WEBSERVER=1 NEXT_DIST_DIR=.next-feedback npm run test:e2e -- e2e/feedback.spec.ts --project=chromium --workers=1`: 4 tests passed. Coverage includes signed-out navigation, fallback visibility, keyboard focus, button height, no horizontal overflow, return navigation, and query/fragment exclusion.
5. `git diff --check`: exit 0.

The CLI screenshots and interactions used `npm run e2e:cli` with the installed Chromium. No browser download occurred.

## Local server

Command: `NEXT_DIST_DIR=.next-feedback PUBMAX_E2E_KEYLESS=1 NEXT_PUBLIC_SW_VERSION=local npm run dev -- --hostname 127.0.0.1 --port 43312`.

Listener PID 36809 had its working directory in this worktree. The 127.0.0.1:43312 listener and its cwd were checked before proof. The server used its own dist directory. No secrets file was copied.

A warm local development response returned HTTP 200, 69,991 bytes, in 0.041587 seconds. This is a single development-server measurement. It is not a production route budget or a cold-load result.

The first long-lived CLI browser retained stale development chunks after the edit. A fresh CLI browser showed the current links. The separate browser test contexts also showed the current links.

## Limits

No full verify or production build ran in this lane. The parent coordinates those shared gates. No push, PR, merge, deployment, provider change, migration or outbound message occurred. The existing mailbox constant was reused. This task did not test inbox delivery or a physical device's mail-client handler.

PR 2307 and 2308 file lists were checked through gh-axi. None of this change's five files overlaps those PRs. Shared navigation, sitemap and route budgets remain parent-owned.
