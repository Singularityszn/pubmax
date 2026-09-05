# One rule: the claim card asks for a handle, and a date of birth is optional

Captain, 5 September 2026 ("one rule"). PR #1556 made the recorded adult tap
the age answer for every contribution. The claim card was the other half of the
rule and had not moved, so the state that tap was written for could not be
reached from the product at all.

## What was measured

Preview D of `d6db5e83d` (scout report `verify-preview-4`, section 12 (e)):

- `/u/you` claim card: `Date of birth` carried no `Optional` tag, its input was
  `required`, and `Claim handle` stayed disabled until a date was typed.
- `GET /api/identity/onboarding` for a fresh account answered
  `{"complete":true,"handle":"vp4b43330","dateOfBirth":"1990-01-01"}`.
- `PATCH /api/identity/onboarding` refused `dateOfBirth: null` and `""` with
  `400 Enter a valid date of birth.`

So every account that build could make held a date of birth, and the report
could not produce the "adult tap, no date of birth" account it set out to test.

## What changed

- The card tags `Date of birth` `Optional`, exactly as `Name` is tagged, drops
  `required`, and enables `Claim handle` on the handle alone. A blank field is
  left OUT of the claim body rather than sent empty.
- `readOptionalDateOfBirth` (`lib/privateIdentity.ts`) is the ONE reading of an
  optional date: `absent` for undefined, null and a blank string, `invalid` for
  a value that is not a date, `given` otherwise.
- `completeOnboarding` with no date claims the handle through
  `identityHandleStore().claim` and writes NO identity row, because
  `private_account_identities.date_of_birth` is NOT NULL. No migration, so the
  deploy order does not matter.
- `PATCH /api/identity/onboarding` reads a blank date as nothing to save. A
  value that is not a date is still `400 Enter a valid date of birth.`
- `/privacy` and `/terms` say `Date of birth is optional.`, because
  "date of birth is needed to finish signup" was a data-path claim.

## Shots

`before/` is `d6db5e83d`'s card, `after/` is this branch's, both at 390x844,
768x1024 and 1440x900. Read them side by side: the `Optional` tag beside
`Date of birth`, and `Claim handle` painted rather than disabled with the date
field empty.

Both lanes come from the same spec:

```
PW_PROOF_SHOTS=1 PW_PROOF_LANE=after npx playwright test --project=chromium \
  e2e/claim-no-birth-date.spec.ts
```

## What is still asked for

Saving OTHER private details (a name, a gender) still needs a date of birth
when the account has none, because the row those details live on cannot be
built without one. That is the one place the answer is not optional, and the
column is the thing to change if it ever must be.

## Two browser tests repaired on the way through

`e2e/price-submission.spec.ts` failed on this rig before any change of mine,
and both failures were the spec's, not the app's.

1. `the one-tap price confirm still works alongside submission` asserted
   `.vpsConfirmBtn`, a class no source file has carried since battle test L03
   retired the anonymous one-tap confirm (`__tests__/priceConfirmRetired.test.ts`,
   PR #1551). It now asserts the correction door that replaced it: `It's changed`
   opens the Pint Drop composer, and `.vpsConfirmBtn` is asserted absent.
2. `a drinker logs tonight's price after completing private signup` expanded the
   venue sheet while the claim card's modal backdrop was up, so every tap landed
   on the backdrop and the retry loop spent the whole 60 s budget. The sheet is
   only needed there for a z-index comparison, which its presence answers; it is
   expanded after the handle is claimed.

After both repairs: `11 passed` over `price-submission`, `arrival-journey` and
`claim-no-birth-date` in one run.
