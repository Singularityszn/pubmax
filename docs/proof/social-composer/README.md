# Social composer proof

Checked 5 August 2026.

Browser fixtures pass the same verified actor boundary without enabling Social beta.

```sh
PW_SCREENSHOTS=1 PW_SOCIAL_COMPOSER_PROOF=1 PW_NEXT_DIST_DIR=.next-task6 npx playwright test e2e/social-composer.spec.ts --project=chromium
```

Result: 10/10 passed in 19.2 seconds against isolated production output.

Coverage includes text and photo posting, failed photo draft reload, stable
idempotency keys, account-switch text and Blob isolation, two-tab warning,
friends-only Venue selection, feature kind, tag approval and withdrawal,
alt-text correction, photo removal, edit conflict recovery, edit reopen, focus
containment, Escape focus return, axe, and no horizontal overflow.

Proof frames:

- `320-light.png`
- `320-dark.png`
- `390-light.png`
- `390-dark.png`
- `430-light.png`
- `430-dark.png`
- `1280-light.png`
- `1280-dark.png`

All frames show final custom photo control. Native file input remains visually
hidden and keyboard focus appears on its labelled control.
