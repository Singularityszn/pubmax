## Problem

<!-- One or two sentences, in plain English. -->

## Change

<!-- What you changed, and why this way. -->

## How I checked it

<!-- Commands and results. For UI: before/after images at the widths you checked. For motion: a short video. Upload them here, never commit them. -->

## What I could not check

<!-- Say "nothing" if nothing. -->

<!--
SHOW-ME BODY: only when this PR touches auth, RLS, prices, money or migrations.
Delete this block otherwise. When it applies, add all three sections:

## Pseudocode
The changed logic, in a few lines.

## Flow
One Mermaid diagram of the request or data flow that changed.

## TDD proof
The three-commit TDD proof: failing-test commit, red run, green run.
-->

## Security checklist

- [ ] No new self-asserted-handle write path without `gateHandleAction` / JWT
- [ ] New `/api/*` routes use `assertServerEnv()` + `jsonNoStore` (no CORS allow-origin)
- [ ] Secrets stay out of client bundles / logs (`ADMIN_TOKEN`, service role, salts)
- [ ] Visibility / privacy: hidden or friends/legacy content cannot leak via feed, comments, reactions, notifications, or storage URLs
- [ ] Uploads (if any) go through magic-byte + EXIF strip seams
- [ ] Tests cover ownership denial and/or visibility gates for changed routes
