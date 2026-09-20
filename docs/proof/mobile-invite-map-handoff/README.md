# Mobile invite RSVP Map handoff proof

Production-browser proof for the public Plan invite flow.

| Proof | Viewport | Contract |
| --- | ---: | --- |
| `invite-before-rsvp-390-light.png` | 390 x 844 | Superseded initial-state capture, not current acceptance evidence |
| `invite-after-rsvp-320-light.png` | 320 x 844 | Confirmed RSVP and full-width Map action |
| `invite-after-rsvp-390-light.png` | 390 x 844 | Confirmed RSVP and full-width Map action |
| `invite-after-rsvp-430-light.png` | 430 x 844 | Confirmed RSVP and full-width Map action |
| `invite-after-rsvp-390-dark.png` | 390 x 844 | Dark-theme action contrast |
| `invite-after-rsvp-390-reduced-motion.png` | 390 x 844 | Reduced-motion rendering |
| `invite-map-focus-390-light.png` | 390 x 844 | Two-tone keyboard focus ring |

The [product spec](../../specs/mobile-invite-rsvp-map-handoff.md) defines the
handoff. The [Playwright spec](../../../e2e/mobile-invite-map-prompt.spec.ts)
owns current browser assertions for initial, returning, confirmed, and failed
RSVP visibility, ordered Map routing, mobile geometry, focus order, and rendered
contrast.

Run clean validation with:

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 \
  PW_PORT=35141 \
  PW_NEXT_DIST_DIR=.next-invite-map-proof \
  npx playwright test e2e/mobile-invite-map-prompt.spec.ts \
  --project=chromium --workers=1
```

Refresh tracked proof only after a deliberate visual change:

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 \
  PUBMAX_UPDATE_INVITE_MAP_PROOF=1 \
  PW_PORT=35141 \
  PW_NEXT_DIST_DIR=.next-invite-map-proof \
  npx playwright test e2e/mobile-invite-map-prompt.spec.ts \
  --project=chromium --workers=1
```

Review every PNG before committing a refresh. Normal validation does not write
tracked proof files.
