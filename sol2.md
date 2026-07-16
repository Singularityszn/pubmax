# sol2.md — THE LOCAL identity and contracts handoff · 2026-07-16

This supplement records the implemented identity boundary for THE LOCAL. It does not replace `sol.md`'s product sequence.

## Public errors

THE LOCAL uses the flat `PublicApiError` wire shape:

```ts
{ error: string; code: string; retryable: boolean; details?: Record<string, unknown> }
```

`publicApiError()` emits it with `Cache-Control: no-store`. The older nested `apiError()` remains untouched for Heritage compatibility.

## Night Profile

`GET/PUT /api/me/night-profile` is account-owned by the verified Supabase Auth user id. A client cannot address another owner. Supabase storage uses `night_profiles` with owner-only RLS; keyless/demo mode uses the same store interface in memory. Anonymous product preferences remain in the validated browser key `pubmaxx.night-profile.v1:device`.

The profile contains a versioned `NightContext`, city, briefing settings, voice mode preference, and an optional owned `pub_pals.id`. Pal name and species remain canonical in `pub_pals` and are never copied into the Night Profile.

`PUT` requires `expectedUpdatedAt`; `null` means create-only. Stale writes return `409 NIGHT_PROFILE_CONFLICT` with the current owner profile in `details`. Device/account merge detection never chooses a winner. Account Hub must receive an explicit “Bring this device” confirmation before it writes; keeping account preferences does not mutate the account.

Never persist precise location/history, voice content, tokens/secrets, or unapproved Pal memories in this profile or its browser adapter.

## External social provider availability

X, Instagram, and TikTok connection controls are server-derived. `/api/social-connections` returns provider capabilities based on the complete server credential set: client id/key, client secret, and a valid social-credential encryption key. Account Hub renders only OAuth providers marked available. Manual personal Instagram linking remains available independently and is server validated.

This gating is unrelated to Google/Microsoft identity and does not change their auth flow.
