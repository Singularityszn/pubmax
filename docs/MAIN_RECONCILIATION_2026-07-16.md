# GitHub `main` reconciliation — 2026-07-16

## Decision

The verified PUBMAXX mobile line at `1b03d02a6bdfb17966148fa6b28a0edbcd5004ba`
is the product and visual source of truth. The twelve commits added to GitHub
`main` after the shared ancestor `a6b9c32657428bc9898359b8d05c564d2c0349ae`
are merged additively. They do not replace the coordinated mobile shell,
four-destination dock, Moment action, shared sheet, camera coordinator, Pub Pal,
or THE LOCAL journey.

Git metadata attributes the twelve commits to `Karan`; it does not establish
which tool or collaborator authored their contents. This reconciliation therefore
refers to the GitHub `main` line rather than assigning human authorship.

## Commit-by-commit result

| Commit | Change | Reconciliation |
|---|---|---|
| `de39beaa` | Vercel Preview environment guard | Integrated. The existing shared `deploymentEnv` helper remains authoritative; Vercel Production ignores the keyless test escape hatch. |
| `454636ea` | Pub-pin reveal independent of basemap tile speed | Integrated with the existing cancellable camera and style lifecycle. Covered by map regression and mobile GL tests before release. |
| `a5d1e6f2` | Data/store review fixes | Integrated. |
| `c3ff19a1` | Venue canonicalization and basemap regression coverage | Integrated. |
| `e9518416` | Environment documentation | Integrated without adding secrets to source control. |
| `ca245519` | Venue-sheet media block closure | Integrated. The shared mobile sheet remains the only contextual-sheet implementation. |
| `8ffcf98b` | Passport seasonal quests and focus accessibility | Integrated. The mobile shell and shared-sheet focus model remain authoritative where they overlap. |
| `75c16b12` | THE LOCAL API contract documentation | Retained as historical/API documentation. Runtime contracts and the verified implementation matrix remain authoritative if wording differs. |
| `c5298a40` | Vitest isolation from Vercel environment | Integrated. |
| `c0e8cbb9` | Dynamic Open Graph cards | Integrated. |
| `ad9391b7` | Robots, sitemap, JSON-LD, and `llms.txt` | Integrated. Site-wide JSON-LD is combined with the mobile layout, Pal summon, and performance instrumentation. |
| `046d05ed` | Programmatic fact layer and London Pint Index | Integrated as additive content and routes; it does not replace the map experience. |

## Visual and journey guardrails

- Preserve PUBMAXX/PUBMAXXING spelling with two Xs and the public apex/`www` URLs.
- Preserve Map, Tonight, Stories, and You as destinations; Moment remains a
  raised compose action with safe return-to behavior.
- Preserve one coordinated top bar, one contextual rail, one shared sheet, and
  one safe-area bottom dock on mobile.
- Preserve one cancellable camera animation and the restored viewport before
  map interaction.
- Treat Search/SEO content as additive. It must not introduce another map row,
  floating card, sheet, or navigation destination.

## Release rule

Only the verified integration commit may be pushed to GitHub `main` and promoted
to Vercel Production. A Vercel `READY` state is not sufficient: both
`pubmaxxing.com` and `www.pubmaxxing.com` must be smoke-tested after aliasing.
