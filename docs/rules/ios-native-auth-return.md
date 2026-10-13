# iPhone provider sign-in return

Free Xcode signing cannot rely on Associated Domains. iPhone Google, Apple and Microsoft sign-in use `NativeAuthSessionPlugin` and `ASWebAuthenticationSession`.

The active native authentication session owns `pubmaxx://native-auth/callback`. Generic `nativeDeepLinks` continue to reject authentication through custom schemes. A callback contains one authorization code and the matching random `_authAttempt`. It contains no access token, refresh token, provider error or arbitrary destination.

`/auth/callback?native=ios-pkce` forwards only those fields to the fixed callback. Its explicit empty fragment prevents a browser from carrying an implicit token fragment into the custom scheme. The relay cannot establish a session.

`lib/nativeAuthClient.ts` creates one disposable PKCE client per attempt. Supabase keeps its verifier in that client's memory. The client has no session persistence, automatic refresh or URL session detection. The canonical browser client retains implicit auth for web, Android and cross-browser email.

The new iPhone PKCE session requires a confirmed signed-out state. An unresolved or unavailable identity cannot start it. An existing account cannot enter this session replacement path.

The explicit signed-in Add account flow remains available from `/login?add=1` and `/signin?add=1`. It uses the existing canonical implicit client and system-browser handoff. The canonical session and settled provider identity must agree before this exception applies. Other signed-in calls remain refused. This exception preserves existing behaviour. It does not repair the existing Add account return on free signing or its SDK replacement failure edge. A signed-out reader on an old installed binary without the plugin receives an update-required message. It does not fall back to WebView OAuth or implicit custom-scheme authentication.

The native callback claims the existing browser auth attempt under its coordination lock. The original PKCE client exchanges the code and verifies the user. The installer checks the canonical session again and refuses to replace an existing account. A fresh, verified session then enters the signed-out canonical client through `setSession`, with its real remote verification intact. Expired or near-expiry tokens are refused before the canonical refresh path. Cancellation, invalid callbacks and failed exchanges leave the signed-out state intact.

Sign-out, account switching, supersession and component cleanup invalidate pending native exchanges. An account action waits for an already-started session installation before it changes the canonical account. The native session retains its presentation window and session until completion. Its callback gate rejects replayed or superseded completions. Native cancellation names its attempt so a delayed cancellation cannot close a later attempt.

The native return navigates to the handle claim when needed, otherwise to the safe intended path and restored return fragment. The current attempt and account must still match.

Referral attribution, return fragments, account onboarding and consent continue through their existing owners. The native URL does not carry these data. The initiating WebView retains them through the existing attempt coordinator.

The Supabase redirect allowlist must admit the canonical HTTPS callback with `native=ios-pkce` and `_authAttempt`. A custom-scheme allowlist entry is unnecessary because Supabase returns to HTTPS first. This source change does not modify production settings.

Focused proof lives in `__tests__/nativeAuthCallbackRoute.test.ts`, `nativeAuthClient.test.ts`, `nativeIOSOAuth.test.ts`, `nativeAuthProvider.test.tsx` and `nativeSessionInstall.test.ts`. The installed-SDK regression proves why an existing account cannot receive a replacement through this path. A failed second user lookup can otherwise clear the unrelated account. The Swift callback gate has executable Foundation checks in `ios/Tests/NativeAuthCallbackTests.swift`.

Run the Swift checks without an app build:

1. Compile with `xcrun swiftc ios/App/App/NativeAuthCallback.swift ios/Tests/NativeAuthCallbackTests.swift -o /tmp/pubmax-native-auth-callback-tests`.
2. Run `/tmp/pubmax-native-auth-callback-tests`.
3. Test the final signed binary on the iPhone after installation approval.

Foundation checks do not prove plugin registration, authentication-session presentation, provider acceptance, signed-device return or the installed binary's source. Those checks require the final native build and device. A web deployment alone cannot add the plugin to an existing installed binary.

Sources: [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [Apple authentication sessions](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession), [Apple custom-scheme callbacks](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/callback/customscheme(_:)).
