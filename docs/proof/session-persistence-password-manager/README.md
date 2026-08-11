# Session persistence and password manager proof

## Browser proof

[Sign-in form at 390 x 844](./sign-in-390x844.png) was captured from this branch with `chrome-devtools-axi` against the keyless local build. The handle and password form is open. The page uses a real form submit control and browser credential fields.

The keyless build cannot sign in, so it cannot render the signed-in account settings form that contains password creation. Its form contract is covered by `__tests__/credentialForms.test.ts` and `__tests__/setAccountPassword.test.ts`.

## Manual production confirmation

After deploy, use one test account on `https://pubmaxxing.com` in both mobile Safari and desktop Chrome.

1. Sign in at `/login` with handle and password. Confirm the browser offers to save the credential. Accept it.
2. Refresh, close and reopen the browser, then revisit `/login`. Confirm the account remains signed in. Repeat in Safari standalone/PWA mode if that is part of the affected journey.
3. In browser storage tools, remove only Supabase local session storage and reload while leaving `pubmax_session_resume` intact. Confirm the account restores without a form. This isolates the HttpOnly resume-cookie path from the normal local-storage path.
4. Sign out, return to `/login`, and use the saved browser credential. Confirm handle and password autofill.
5. From signed-in account settings, confirm the password form has `new-password` semantics. Set a password on a test account and confirm the browser offers to save or update it.
6. Inspect the persist response cookie. It must include `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Max-Age=2592000`, with no `Domain` attribute.

No diagnostic logging is required. The automated tests cover the bootstrap ordering and cookie attributes.
