// This document bypasses the React layout and its speculative asset fetches.
// The shared pre-paint script owns the decision and falls back to the root
// when the bridge or storage is unavailable, or for an auth callback.
// Use a fresh script URL so an upgraded shell cannot reuse the root-only script.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>PUBMAXXING</title>
<script src="/theme-init.js?v=entry-v1"></script>
</head><body></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
