# Contributor Identity Foundation Implementation Plan

**Goal:** Bind current community price and venue-signal contributions to
authenticated accounts with public handles while keeping private profile data
private.

**Current policy:** Date of birth is required at signup and stored as private
profile data. Full name and sex are optional private profile data. PUBMAXX uses
these fields for product analytics and social features. No account or
contribution is blocked based on age. This policy replaces the earlier
contribution age-gate design.

## Constraints

- Preserve magic-link sign-in.
- Keep Google and Apple behind provider availability.
- Reserve `karan`, `sarah`, `carol`, and `erin` through one code list.
- Let the first verified claimant take an unlinked legacy handle and its history.
- Keep handle, date of birth, optional full name and optional sex on one compact
  390px onboarding screen, in that order.
- Publish handle only. Never return private profile fields from public profile,
  leaderboard, contribution, or venue surfaces.
- Require account identity for current community price and venue-signal writes.
- Keep anonymous Round entries in the diary. Promote only signed-in,
  handle-bound first-party lines.
- Persist each Round line's promotion outcome and retry dependency failures
  without charging or promoting the line twice.
- Keep Visit Reports and Recommendations as explicit identity follow-up work.

## Implementation slices

### Account identity

- Store required `date_of_birth` with optional `full_name` and `sex` in
  `private_account_identities`.
- Validate date format, real calendar dates, future dates, and the supported
  lower bound at the server boundary.
- Treat onboarding as complete only when both the public profile and private
  date of birth exist.
- Bind onboarding and private-profile mutations to the captured account token.

### Contribution boundary

- Resolve the stable profile actor and current public handle from the verified
  account.
- Return actionable sign-in or onboarding states when identity is unavailable.
- Keep all age-derived states, eligibility dates, and age-assessment routes out
  of the contribution path.

### Round promotion

- Keep unauthenticated and demo-menu lines diary-only.
- Send signed-in Round writes with an immutable account snapshot.
- Persist `diary_only`, `pending`, `ready`, `promoted`, or `superseded` for each
  line.
- Bind pending promotion privately to its authenticated account owner.
- Charge the account budget before moving `pending` to `ready`.
- Let the latest successful line for each account, venue and drink category own
  the community row, and mark its displaced source line `superseded` only when
  ownership transfers.
- Retry only `pending` or `ready` lines and show community-price copy only for
  `promoted` lines.

### Privacy and product language

- State required date of birth, optional full name and sex, product analytics
  and social-feature purposes, private visibility, and profile-deletion
  retention in Privacy and Terms. Profile deletion removes these private fields
  while leaving the authentication account, public handle and contribution
  history in place.
- State that no age blocks signup or contribution.
- Keep the handle as the only public identity.

### Regression coverage

- Pin required private date of birth and all-age contribution.
- Pin account-bound Round requests and anonymous diary requests.
- Pin durable partial promotion, retry, ownership, and truthful UI captions.
- Pin legal wording and mutating-route inventory.
