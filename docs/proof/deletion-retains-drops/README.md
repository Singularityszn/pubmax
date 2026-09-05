# We keep the prices, and we remember these accounts

Captain, 5 September 2026: "We keep the prices, but we remember these accounts
and what they have logged in." Verification scout verify-preview-4 (sections
7.3, 10 and 13) measured what that is about: a throwaway account deleted itself
through the product, its two Pint Drops stayed on the map exactly as they
should, and both were still printed under the retired handle `vp4qa39758`, one
of them leading the Blackfriar sheet on production.

## The measured surface

The rendered change is the `/privacy` retention list. Three bullets, shot at the
head of the `How long we keep it` section:

- **After you delete your account** is new, and is the whole ruling in one
  sentence.
- **Community prices and venue reports** and **Recommendations** each gained a
  clause, because both said an attribution stays "while it is up" and that was
  no longer exact once a departure takes the name off.

| Width | Before | After |
|---|---|---|
| 390x844 | `before-privacy-retention-390x844.png` | `after-privacy-retention-390x844.png` |
| 768x1024 | `before-privacy-retention-768x1024.png` | `after-privacy-retention-768x1024.png` |
| 1440x900 | `before-privacy-retention-1440x900.png` | `after-privacy-retention-1440x900.png` |

Before is production (`https://pubmaxxing.com/privacy`, serving `origin/main`).
After is a local production build of this branch (`NEXT_DIST_DIR=.next-prod npm
run build`, served on port 3111), Chromium through Playwright, scrolled to
`#keep`. No copy wraps short, no bullet truncates, and the phone shot clears the
tab bar and the create control.

## What is not shot, and why

A retired handle on a pub sheet needs a real account deletion, which needs
GoTrue: no browser test on a keyless server can produce one. That half is
measured where it can be:

- `__tests__/accountRetentionLedgerMigrationEffective.test.ts` runs a real
  PostgreSQL 16 under the 0145 storage-guard replica, reproduces both faults
  before migration 0150, and proves the ledger row, the contribution ids, the
  stamps, the surviving prices and dates, the narrowed contributor board and the
  client refusal after it, then the rollback.
- `__tests__/retiredContributor.test.ts` holds the reading half: each lane's ONE
  public projection swaps the name and keeps the price, the measure, the date
  and the authority key.
