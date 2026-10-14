# iPhone email-link return

The iPhone email-link flow must return to the initiating app. Free Xcode signing cannot rely on universal links or Associated Domains.

Signed-out iPhone email requests use the public Supabase `/auth/v1/otp` PKCE contract. WebCrypto generates a random verifier and its S256 challenge. The request sends the challenge, never the verifier. The canonical Supabase singleton remains implicit for web, Android and cross-browser email.

`native=ios-email-pkce` selects a separate HTTPS callback relay. It returns only the authorization code and random `_authAttempt` to `pubmaxx://native-email/callback`. The explicit empty fragment replaces an inherited fragment. It forwards no session tokens, provider errors, return target or referral proof.

`nativeEmailLinks` registers the Capacitor App event with `App.addListener("appUrlOpen", ...)` and reads the launch URL with `App.getLaunchUrl()`. It accepts the fixed custom callback and strict same-origin HTTPS callbacks for this mode. This supports paid shells where the OS intercepts the HTTPS link before the relay runs. The general native router refuses this mode and continues to reject custom-scheme authentication. The dedicated consumer rejects duplicate fields, foreign origins, credentials, token fragments and unknown parameters. Incoming return/proof fields have no authority.

GoTrue PKCE verification failures carry error fields in the query and repeat them in a fragment with `sb=`. The dedicated HTTPS consumer recognizes this bounded shape and returns only the attempt ID with no code. It requires the stored attempt before clearing the verifier and showing a generic failure. It rejects token fields and inconsistent error fragments. It never stores, displays or forwards provider prose. The custom callback accepts no error fields or nonempty fragment.

One localStorage receipt retains the verifier, attempt ID, public auth origin, normalized expected email, original callback metadata and expiry. It stores no JWT, refresh token, callback code or API key. The receipt expires after one hour. It is removed before exchange, on explicit cancellation, sign-out, account switching or supersession. A component cleanup invalidates active work and listeners but retains an unclaimed receipt for the next document. Cold return needs no initiating sessionStorage marker.

The existing auth coordinator claims the attempt under its Web Lock. It retains the return fragment and referral proof across a document restart. Callback deduplication cannot invalidate the first active exchange. A late crypto preparation cannot overwrite a newer receipt. A changed public auth project cannot receive the stored verifier.

Callbacks wait for auth bootstrap to settle. The exchange uses `/auth/v1/token?grant_type=pkce`, followed by a real remote user lookup. Every result requires a confirmed email. Typed-email requests also require that the verified email matches the normalized requested address. A banned, mismatched, expired or revoked result cannot install a session.

The canonical installer checks that the app is still signed out. Sign-out and account switching invalidate pending exchanges and wait for an already-started installation. The final return requires the current attempt and installed account. It consumes the original referral fragment and preserves other return fragments. It navigates to the handle claim when needed, otherwise to the safe intended path.

Welcome-back resume uses the same verifier lifetime. `/api/auth/session` takes a validated S256 challenge only for this native relay. It sends the email to the HttpOnly cookie's address and exposes no full email. Its existing same-origin checks, rate limits and public error normalization remain in force.

The explicit signed-in Add account flow remains on its existing implicit path. The new native session does not replace an existing account. The existing Add account return limitation on free signing and the existing SDK replacement failure edge remain separate work.

The hosted MagicLink and ConfirmSignup templates must preserve a PKCE-capable ConfirmationURL. GoTrue accepts the callback without an allowlist match when its scheme, hostname and explicit port match SiteURL. Otherwise, an allowlist pattern must admit the callback query. Hosted SiteURL, Auth version and templates remain unverified. This source change does not modify hosted settings. It does not introduce an OTP-entry interface or depend on a template exposing a numeric code.

Focused tests include the mounted app, HTTP relay and both App consumers. They cover warm and real unmount/remount cold returns, readiness, deduplication, S256 transport, storage failure, identity checks, cancellation, account races, referral consumption and legacy behaviour. These tests use fake HTTP responses and native events. They do not prove delivery by Mail, Safari handoff, hosted configuration, the installed binary or a physical iPhone.

Sources: [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [GoTrue redirect validation](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/utilities/request.go#L94-L135), [GoTrue verification redirects](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/api/verify.go), [Capacitor App events](https://capacitorjs.com/docs/apis/app).
