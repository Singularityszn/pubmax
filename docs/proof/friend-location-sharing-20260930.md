# Friend location sharing completion evidence

Isolated branch `codex/friends-completion-20260930`, based on `db1a457900bd406087547d1b5c8052bdb330d777`. The original friends worktree was read only. Thirty-three explicit implementation, test and proof files were copied; source hashes matched before and after copying. No secrets, fixture manifests, logs, screenshots, dependency directories or caches were transferred.

## Remaining Stop races

The delayed Stop reconciliation regression failed before repair: a refresh had confirmed generation 3 and a newer session, then the awaited reconciliation receipt replaced both with generation 2 and the older session. The controller now checks operation identity, disposal and the current generation after the reconciliation await, before applying its receipt. It also checks operation identity and disposal after the preceding GET.

The revoked-row Retry Stop regression was replayed against the prior SQL branch in this isolated worktree. It failed because generation stayed 2 after a successful retry. The carried SQL repair now sends retry confirmation through the ordinary revoke path, increasing generation, retaining the first revoke timestamp and keeping coordinates null. An earlier pending start must then fail its generation comparison under the actor lock.

After both repairs, eight focused suites passed 117 checks in 14.74 seconds. This includes the real PostgreSQL migration proof, the complete effective permission matrix and the delayed-auth route retry. Whole-application typecheck passed. Scoped ESLint over the friend policy, service, controller, routes, UI and tests passed with no output.

Retained local logs live in ignored `artifacts/friend-location-proof/completion-*`. A new full verification, production build, independent current-head review and three-identity responsive browser walkthrough remain required. Earlier verification in [29 September proof](friend-location-sharing-20260929.md) applies to older candidates.

## Integration boundary

The integrated v0 migration chain currently occupies labels through 0174. The friends migration label in this isolated tree is provisional until the parent reserves the next free number. Map, CI and shared PostgreSQL inventory integration also need an agreed current base. No original-worktree edits, publication, live migration, merge or deployment occurred.

Heavy runtime remains held while the core QA owner uses its allocated window. No proof backend, server, build or browser was started in this lane.
