# Account identity recovery and You profile photos

Base: `feb327794` on `origin/main`. Each before shot comes from a production build of that base.
Each after shot comes from a production build of this branch.
Both builds ran the same temporary Playwright proof script with the same auth doubles.
The script is not committed.

## What each pair shows

| Pair | Before | After |
| --- | --- | --- |
| `*-profile-desktop.png`, `*-profile-phone.png` | Account B has no profile photo. The account button shows the sign-in provider picture (blue). | The account button shows the initials of account B. The You page has the new cover, section links and passport column. |
| `*-login-phone.png` | The signed-in card shows the provider picture. | The signed-in card shows the initials. |
| `*-you-unavailable-phone.png` | The identity read answers 503. After 10 seconds, the You page still shows a loading skeleton. | The page says "Your profile could not load" and offers **Retry**. |
| `*-social-unavailable-desktop.png` | The identity read answers 503. After 10 seconds, Social still says "Checking Social access". | Social says it is unavailable and offers **Retry**. Retry reads the identity again without a page reload. |

## Checks

- Unit tests: `__tests__/accountIdentityRecovery.test.tsx` and the new case in
  `__tests__/accountMenuIdentity.test.ts` fail on the base (6 failures) and pass on this branch.
- Browser tests: `e2e/you-profile-identity.spec.ts` and 11 related profile, login and
  account-switch specs passed on this branch (87 passed).
