# Social shell proof

Task 5 browser proof for canonical `/social`.

## Feed shell

- `320-light.png`, `320-dark.png`
- `390-light.png`, `390-dark.png`
- `430-light.png`, `430-dark.png`
- `1280-light.png`, `1280-dark.png`
- `1440-light.png`, `1440-dark.png`
- `390-nearby-long-light.png`: long Nearby content, venue action, and explicit pagination

## Embedded Discover

- `320-discover-light.png`
- `390-discover-dark.png`
- `430-discover-dark.png`
- `1280-discover-dark.png`
- `1440-discover-light.png`
- `390-discover-dark-focus-middle.png`: keyboard focus above fixed mobile tabs
- `390-discover-dark-focus-end.png`: final keyboard control above fixed mobile tabs

## Verification

Production build used isolated output:

```sh
NEXT_DIST_DIR=.next-task5-final3 npm run build
```

Browser suite used that production server:

```sh
PW_SKIP_WEBSERVER=1 PW_PORT=32113 npx playwright test e2e/social-shell.spec.ts --project=chromium --workers=1
```

Result: 10 passed. Suite covers safe preview boundaries, protected request isolation, chronological pagination, refresh and Back state, stale request cancellation, direct redirects, URL fail-closed behaviour, keyboard navigation, axe, theme and viewport fit, and generic authorised Activity rows.
