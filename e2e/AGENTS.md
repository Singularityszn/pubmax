# The browser suite

Playwright: the server it drives, the state it clears, and how an agent takes browser evidence. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **Wait for the event.** Fixed sleeps and test-runner retries are forbidden. Web-first auto-retrying assertions (`expect(...).toPass()`) and auto-waiting locators are allowed.
- **A spec that asserts London-hour or calendar-dependent UI pins the clock.** Use the Playwright page clock. A spec that reads colour or theme stores its theme. With no stored choice, the app is dark from 21:30 to 04:00 London time. Use `storeThemeChoice` or `holdLondonAfternoon` from `e2e/helpers/themeClock.ts`.
- **A hand-started server on the e2e port makes Playwright lie.** Playwright reuses any listener on its port. `playwright.config.ts` owns the server env (`webServer.env`): rate-limit allowance, Plan signing secret and `PUBMAX_TRACKED_OUTPUTS`. Free the port, or start your server with the same env and `PW_SKIP_WEBSERVER=1`.
- **Never change production rate limits for a test.** The e2e server raises its budget only through `PUBMAX_E2E_RATE_LIMIT_MAX`.
- **One browser cache, one Playwright version.** A lane never installs or downloads a browser. Never add the separate `@playwright/cli` package. A tool that needs another browser uses its own `PLAYWRIGHT_BROWSERS_PATH` under the gitignored artifacts folder.
- **A tap before hydration is dropped without a sign.** Retry the tap inside `expect(...).toPass()`, not the assertion after it. Before you decide a surface is missing, open the page and click it yourself.
- **Never guess where a pin is.** Pins paint on the canvas. Read `paintedMapTapPoints` from `components/map/canvas/paintedPinProbe.ts`.
- **One helper per wait.** Use `e2e/helpers/mobileMapShell.ts` for the phone map shell, `e2e/helpers/mapToolbar.ts` for the toolbar, and `e2e/helpers/priceBill.ts` to attach a bill to a price.
- **A spec that reads the map credit fixes the basemap.** Use `installDeterministicMapBasemap` from `e2e/helpers/mapNetworkFixtures.ts`.
- **Planner state persists in `localStorage`.** Test the planner by hand in a fresh profile.

## Browser evidence for agents

- Use `npm run e2e:cli -- <command>` with `--browser=chromium` against a private-port production build. Write shots and snapshots under the gitignored artifacts folder.
- `npm run proof:design` takes a design proof sheet: each page at 390 and 1440 wide, light and dark.
- Upload evidence to the PR. Never commit it.
- Use `chrome-devtools-axi` only for Lighthouse, traces and heap snapshots.

## Detail

Full rules, pins and history: [`docs/rules/e2e-browser-suite-and-evidence.md`](../docs/rules/e2e-browser-suite-and-evidence.md).
