# Signed-out profile message spacing

The signed-out public profile placed "Continue with email" directly against
"Sign in to message". The rendered gap was 0px. A scoped grid now separates
the hint and the email form by the existing `--space-3` token, which is 12px.

The baseline is current main at `835b91ab6ffeaca1533c612ad88db470aaae8b96`.
Both captures use production builds, the same public-profile fixture, and a
signed-out browser with no session. The server stores are keyless. The fixture
uses loopback only, returns a public profile and disabled social providers,
and refuses every request except GET and HEAD. No sign-in was submitted.
The fixture does not populate durable identity aliases or prove production
authentication.

"Sign in to message" is a non-interactive hint. "Continue with email" labels
the email field. The actual controls are the follow link, email field, and
email submit button. The change preserves their existing semantics and order.

| View | Before | After | Gap | Email field | Submit button |
| --- | --- | --- | --- | --- | --- |
| 390x844 light | [Before](before-390-light.png) | [After](after-390-light.png) | 0px to 12px | 308x44px | 308x44px |
| 390x844 dark | [Before](before-390-dark.png) | [After](after-390-dark.png) | 0px to 12px | 308x44px | 308x44px |
| 1440x900 light | [Before](before-1440-light.png) | [After](after-1440-light.png) | 0px to 12px | 298.67x44px | 298.67x44px |
| 1440x900 dark | [Before](before-1440-dark.png) | [After](after-1440-dark.png) | 0px to 12px | 298.67x44px | 298.67x44px |

The follow link measures 145.41x44px in every view. Every control's centre
hits that control. No view scrolls horizontally. The adjacent JSON files
record the DOM geometry, control tags, disabled states, and follow destination.
The follow destination remains `/login?mode=signin&from=%2Fu%2Ftestdrinker`.

Keyboard proof uses actual Tab, typing, and Shift+Tab events. Tab from the
follow link reaches the email field. Entering `person@example.test` enables
the submit button. Tab reaches that button. Shift+Tab returns to the field.
Both controls show a 2px focus outline with a 2px offset in all four views.
The `keyboard-*.json` files record those results. The `focus-*.png` files show
the focused submit button. The field was cleared without submitting it.

The browser spacing assertion failed before the change with a 0px gap and
passed after the change with a 12px gap. The three existing auth suites passed
33 tests. The existing profile hero and mobile profile browser suites passed
seven tests against the production server using installed Chrome. The default
Playwright browser was absent, so the run used a temporary local configuration
that changed only the browser channel and retained the repository test setup.

`npm run verify:no-mistakes` completed with exit 0 after installing the current
lockfile dependencies. It runs the repository merge bar, including lint, type
checks, unit coverage, disposable PostgreSQL checks, and the audit gate.
The freshness check cannot measure three durable feeds in the keyless runtime.
It reports that limitation explicitly and does not mark those feeds fresh.
