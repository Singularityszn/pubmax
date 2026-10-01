# Banned callback regression

Status: SOURCE ONLY, UNRUN. Product code unchanged.

Ported the two focused upstream test hunks from main `af5a08f78afad1091efc7ed97d1906daf9b47db1` into Core's existing suites:

- `authCallbackClient.test.ts` requires provider bans during original-user verification, refresh minting and refreshed-user verification to return `banned` without installing a session. Ordinary refusal remains `verification-failed`.
- `deviceAccountSwitch.test.ts` requires a verified `user_banned` token response to preserve the refusal classification. Ordinary refusal has no ban marker.

Kept Core's `installingTokens` assertion and all existing tests. No whole-file replacement, source merge, auth-controller change or token capture occurred. Fixture strings are synthetic. These tests are expected to fail against current Core; no run or provider result is claimed.

Focused commands, UNRUN:

```sh
./node_modules/.bin/vitest run __tests__/authCallbackClient.test.ts -t 'reports a banned account behind an unowned callback'
./node_modules/.bin/vitest run __tests__/deviceAccountSwitch.test.ts -t 'separates a refused token'
```

After captured RED, compose the narrow helper/device-switch/controller behavior with Core's newer cancellation, explicit logout, bootstrap and newer-login arbitration. Keep original-pair verification and confirmation before installation. Run both whole suites and existing provider race coverage before native account controls. Synthetic provider cases do not prove real Google/email sign-in or account switching.
