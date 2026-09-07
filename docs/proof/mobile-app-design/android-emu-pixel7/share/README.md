# Share on Android: the OS picker never opened

Rig: Pixel 7 AVD, API 36, WebView 133, local keyless build of this branch,
`/tonight` inside the shell.

## Before

`tonight-share-sheet.png`: the Tonight page's Share control answered "Could
not share tonight. Try again." Two faults stacked under it.

1. The Android System WebView has no `navigator.share`, and the Tonight
   button (with eight other surfaces) calls it directly rather than through
   `lib/shareSheet.ts`, so inside the shell it took its own fallback: the
   clipboard, which a cleartext origin refuses, hence the sentence. On the
   shipped https origin it would have copied a link in silence instead of
   opening the picker.
2. The seam that IS meant to ask the OS picker first, `lib/nativeShare.ts`,
   never worked in either shell. Its loader returned the Capacitor plugin
   from an `async` function, and a Capacitor plugin is a Proxy that answers
   every property with a native call, `then` included, so the `await` called
   `Share.then()` and the WebView console recorded
   `Uncaught (in promise) Error: "Share.then()" is not implemented on android`.
   Every share through that seam answered `unavailable` and fell to the web
   path. `lib/nativeReviewPrompt.ts` had the same shape, so the store review
   was never requested either.

## After

`after-tonight-share-sheet.png`: the same tap opens the Android share sheet
with the page's own text and link. `lib/nativeWebShareBridge.ts` fills
`navigator.share` over the plugin from `components/native/NativeShellChrome.tsx`
(a fill, never an override: WKWebView ships the API and keeps it), and the
three loaders hand back a plain object that closes over the plugin.
`__tests__/capacitorPluginProxy.test.ts` drives every default loader against a
proxy shaped like the real one; `__tests__/nativeWebShareBridge.test.ts` holds
the fill.
