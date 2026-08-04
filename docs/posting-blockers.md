# Posting blockers

## Local Supabase browser auth key

On 2026-08-04, Firefox sign-in against the local dev app sent the configured `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the project Auth endpoints. Both `/auth/v1/settings` and `/auth/v1/token` returned HTTP 401 with `Invalid API key`. The same key produced the same error from `@supabase/supabase-js` and `curl`.

The authenticated posting path itself works: a real Supabase session generated from a temporary admin magic link completed onboarding, posted a photo Pint Drop with HTTP 201, returned a signed private-Storage photo URL, and rendered the exact story and photo in `/feed` and the venue sheet. The Firefox screenshots in `docs/proof/pint-drop/` record that path.

The publishable key needs to be corrected in the local environment before the normal browser sign-in journey can be re-proven. No live migration or production configuration was changed.
