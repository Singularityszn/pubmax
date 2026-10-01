# R47 320px navigation and account source review

Read-only source review. No browser or test run was performed here.

The frozen Core candidate already differs from Main in a narrow-phone auth layout rule. Main `f33f77e42b8a045695529ec87f2ed1b6ed4cb719` limits the compact-trigger compression to 641-900px. Core `5de246205d8ff0fd1d601c94f3a73639476a3db1` also applies it at widths up to 360px:

```diff
-/* Tablet band only: the eight-link row is at its densest, so the trigger
-   drops to an icon-only 44px disc (its aria-label keeps the accessible name)
-   and the labels get the room back. Phones (≤640px) are excluded on purpose:
-   SiteNav hides only the full signed-in row there, not .authUserNav, so the
-   compact Sign in matches the landing bar; the bottom tab bar still owns
-   primary navigation. */
-@media (min-width: 641px) and (max-width: 900px) {
+/* The tablet link row and the narrowest phone bars need the account trigger's
+   width back. Its accessible name stays on the 44px icon control. */
+@media (max-width: 360px), (min-width: 641px) and (max-width: 900px) {
```

At [auth.css](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/app/auth/auth.css:495), the rule hides `.authCompactLabel` and fixes `.authCompactTrigger` to 44px. It covers both the compact signed-in Account button and signed-out Sign in link; their accessible names remain in [SignInButton.tsx](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/components/auth/SignInButton.tsx:394) and [SignInButton.tsx](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/components/auth/SignInButton.tsx:534). This is the relevant width-saving difference from Main.

The other Main-to-Core delta in these files is [siteNav.css](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/components/nav/siteNav.css:89), which raises an open in-flow auth menu's stacking order. It does not change horizontal geometry. `SiteNav.tsx` and `SignInButton.tsx` have no Main-to-Core source diff. The compact action row still keeps its children unshrunk at phone widths, with 2px gaps at 360px and below ([siteNav.css](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/components/nav/siteNav.css:734), [siteNav.css](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/components/nav/siteNav.css:768)); the auth change reduces one child's width but does not by itself prove the full row fits.

The reported Messaging sample is parent-provided: at a 320px viewport, `documentElement.clientWidth` was 305px and `.siteNavActions.right` was 324.875px. That puts the action edge 19.875px beyond the measured client width. This review did not reproduce it and does not establish whether it came from Main or Core. Core's existing [mobile-site-nav.spec.ts](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/mobile-site-nav.spec.ts:63) checks a signed-in account control and page overflow at 320px on `/pubs` and `/today`; it does not cover the signed-out `/messages` state. The 320px cases in [mobile-map-chrome-fit.spec.ts](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/mobile-map-chrome-fit.spec.ts:678) and [mobile-map-chrome-fit.spec.ts](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/mobile-map-chrome-fit.spec.ts:765) measure map chrome, not this shared navigation row. The existing global-nav test's no-overflow ceiling is at most 1px.

For a Core diagnosis, retain the existing 320px viewport and measure the nav bar, each action child, `siteNavActions`, and document `scrollWidth`/`clientWidth` on `/messages` with the reported auth state. The source already contains the narrow-phone compact-trigger rule, so another CSS change needs a failing Core reproduction first. Current Core browser status remains unproved by this source review.

Custody: source freeze [r47-source-freeze.json](/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/docs/proof/refined-v0-recovery-20260930/r47-source-freeze.json) records HEAD `5de246205d8ff0fd1d601c94f3a73639476a3db1`, status `UNVERIFIED_SOURCE_ONLY`, created `2026-10-01T00:59:53Z`. Current SHA-256 values for `app/auth/auth.css` (`5ad68f38dd8acbc0f5716329415bc82c15cf8dcf946d519f307f2e3d5c114341`), `components/nav/siteNav.css` (`bf635f26c1ae64f4aed4ab982a7f5496adc43e890cff9e34ae0db4432e17c420`), `components/nav/SiteNav.tsx` (`d7944492f467a2edac32182ede7bddc7e4b6621a600f6ada02ee4a7ae061acdd`) and `components/auth/SignInButton.tsx` (`b1ff7ab1c5ece162f99f104547028594f899f0402b7ca791ab83137cdee9d766`) match that freeze. Those four files have no uncommitted changes in this checkout.
