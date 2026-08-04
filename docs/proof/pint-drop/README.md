# Pint Drop Firefox proof

Captured 2026-08-04 against the local app with Firefox and a private `pint-drops` bucket.

The run created one temporary Supabase account, completed public-handle onboarding, posted a Pint Drop with `.tmp-evidence/paint2.png`, received HTTP 201 and a signed photo URL, then verified the exact story and photo in both `/feed` and the Prospect of Whitby venue sheet. The account, row, and Storage object were removed after capture.

Screenshots cover 390x844 and 1440x900 in light and dark themes:

- `390-light-feed-firefox.png`
- `390-light-venue-firefox.png`
- `390-dark-feed-firefox.png`
- `390-dark-venue-firefox.png`
- `1440-light-feed-firefox.png`
- `1440-light-venue-firefox.png`
- `1440-dark-feed-firefox.png`
- `1440-dark-venue-firefox.png`

The normal browser email sign-in form could not be completed in this worktree because the configured Supabase publishable key returned HTTP 401 `Invalid API key`. The screenshots therefore prove the authenticated posting and readback path with a real Supabase session, but do not claim that the local sign-in form is healthy.

The private Storage read policies remain in `supabase/migrations/20260804120000_0065_private_pint_drop_storage_policies.sql` and were not applied.
