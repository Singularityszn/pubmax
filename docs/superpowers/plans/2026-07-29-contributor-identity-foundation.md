# Contributor Identity Foundation Implementation Plan

**Goal:** Bind current community price and venue-signal contributions to
authenticated accounts with public handles while keeping private profile data
private.

**Current policy:** Handle alone is required at signup. Full name and sex are
optional private profile data. Date of birth is asked only immediately before
the first gated contribution and discarded after assessment. The account keeps
only adult confirmation or an under-18 eligibility date.

## Constraints

- Preserve magic-link sign-in.
- Keep Google and Apple behind provider availability.
- Keep reserved contributor handles in the single
  `RESERVED_CONTRIBUTOR_HANDLES` code list.
- Let the first verified claimant take an unlinked legacy handle and its history.
- Keep handle, optional full name and optional sex on one compact 390px
  onboarding screen.
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

- Store optional `full_name` and `sex` plus derived contribution eligibility in
  `private_account_identities`; never store raw date of birth.
- Validate date format, real calendar dates, future dates, and the supported
  lower bound at the one-time age-assessment boundary.
- Treat onboarding as complete once the public handle is claimed.
- Bind onboarding and private-profile mutations to the captured account token.

### Contribution boundary

- Resolve the stable profile actor and current public handle from the verified
  account.
- Return actionable sign-in, onboarding, age-assessment, and under-18 states.
- Ask for date of birth only after the first price or venue-signal write reaches
  the gate, then retry that write after an adult result.

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

- State optional full name and sex, one-time date-of-birth assessment, derived
  eligibility retention, private visibility, and profile-deletion retention in
  Privacy and Terms. Profile deletion removes these private fields while
  leaving the authentication account, public handle and contribution history
  in place.
- State that under-18 accounts cannot contribute but can browse.
- Keep the handle as the only public identity.

### Regression coverage

- Pin handle-only onboarding, discarded date of birth, and under-18 blocking.
- Pin account-bound Round requests and anonymous diary requests.
- Pin durable partial promotion, retry, ownership, and truthful UI captions.
- Pin legal wording and mutating-route inventory.
