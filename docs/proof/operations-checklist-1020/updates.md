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

This directory retains these historical images in Git:

- [Before](./updates-before.png) shows the absent route.
- [After on mobile](./updates-after-mobile.png) shows the development page at 390 by 844.
- [Production phone capture](./updates-production-phone.png) records the historical production page.

The desktop image and local test logs were not retained in this checkout.
They are not evidence attached to this PR.

The before and development images used a private development server. Its hot-reload WebSocket failed,
so its console cannot establish production health. The production image is a historical capture,
not a check of this PR head. Current production browser checks remain separate.
No deployment or merge is claimed by this proof.

## Hosted evidence from 22 October 2026

[Browser run 39763593048](https://github.com/Singularityszn/pubmax/actions/runs/39763593048)
captured the signed-out account and updates pages at widths of 390, 768 and 1440 pixels.
Its after revision is `bd7dd939b5d6c1e2af54020ce96c9863c6604210`.
Its immutable before revision is `325122c23eb9d8bc809c4388448c0e5459146152`.

- [Before artifact](https://github.com/Singularityszn/pubmax/actions/runs/39763593048/artifacts/12421912262): `public-ui-pr2311-before-bd7dd939b5d6c1e2af54020ce96c9863c6604210`.
- [After artifact](https://github.com/Singularityszn/pubmax/actions/runs/39763593048/artifacts/12423107257): `public-ui-pr2311-after-bd7dd939b5d6c1e2af54020ce96c9863c6604210`.

Each artifact contains six public PNGs and `identity.json`, which records source and served revisions and image hashes.
GitHub retains these artifacts for seven days. They do not establish acceptance of a later revision or a production deployment.

## Independent publication on 22 October 2026

This PR contains only the released updates page, its account entry, sitemap discovery and route budget. It excludes feedback and Realtime changes. The attached screenshots and production measurements describe the 20 October implementation. Fresh publication checks must bind to the new PR head.
