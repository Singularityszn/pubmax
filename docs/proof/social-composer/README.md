# Social composer proof

Checked 5 August 2026.

Browser fixtures pass the same verified actor boundary without changing Social's
launch state.

```sh
PW_SCREENSHOTS=1 PW_SOCIAL_COMPOSER_PROOF=1 PW_NEXT_DIST_DIR=.next-task6 npx playwright test e2e/social-composer.spec.ts --project=chromium
```

Result: 14/14 passed against isolated production output.

Coverage includes text and photo posting, failed photo draft reload, stable
idempotency keys, account-switch text and Blob isolation, two-sided tab warning,
explicit draft clearing, accessible Venue selection, all visibility and comment
choices, immediate owner outbox state, feature kind, informed tag approval,
audience-conflict review, paged withdrawal, photo preview and removal, alt-text
correction, edit conflict recovery, edit reopen, bounded owner-outbox pagination,
retryable page errors, deduplication, honest visibility labels, focus containment,
independent tag-lane read failures, retry without data loss, Escape focus return,
axe, and no horizontal overflow.

Proof frames:

- `320-light.png`
- `320-dark.png`
- `390-light.png`
- `390-dark.png`
- `430-light.png`
- `430-dark.png`
- `1280-light.png`
- `1280-dark.png`
- `390-light-outbox-load-more-final.png` - 44px control for older owner posts
- `390-light-outbox-pagination-final.png` - accumulated Friends, Public, and Private rows

All composer frames show final custom photo control. Native file input remains
visually hidden and keyboard focus appears on its labelled control.
