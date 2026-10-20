# Public updates page

This change adds `/updates` and links it from the account support section.
The page records released product changes. It does not read Git history at runtime.

## Release evidence

The production `/api/version` response on 20 October 2026 identified commit
`3fef16654b59598af81771045a75c63add5e43a6` and deployment
`dpl_CzZfa8gr3jBCMi1ygV5Foj2yhyU1`. Vercel reported that deployment ready at
2026-10-19T18:13:49.552Z.

The first note describes these released changes:

- PR #2306 added prices from published London pub menus. Its merge commit is the production commit above.
- PR #2304 moved late price rows below the getting-home section. Its merge commit, `b12687dfa`, is an ancestor of that production commit.

The note omits the open map-performance and Pub Pal PRs.
Future notes require the same release check before they appear here.

## Before and after

Before this change, `/updates` returned the app's 404 page.
After this change, a signed-out reader can read a dated note and open the map.
The canonical address is `/updates`. The sitemap uses the latest note's release date.
The new feedback and updates sitemap entries carry route budgets.
The forbidden-path sitemap test now checks path boundaries so `/feedback` does not match `/feed`.

The local proof folder is `artifacts/operations-checklist-1020/`:

- `updates-before.png` shows the absent route.
- `updates-before-test.log` records the missing-module test failure.
- `updates-after-mobile.png` shows the page at 390 by 844.
- `updates-after-desktop.png` shows the page at 1440 by 1000.
- `updates-sitemap-test.log` records 102 passing tests across the page, sitemap and budget suites.

These screenshots use a private development server. Its hot-reload WebSocket failed,
so its console cannot establish production health. Production browser checks remain separate.
No deployment or merge is claimed by this proof.
