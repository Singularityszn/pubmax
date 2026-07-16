# Night signal claim candidates

Scheduled ingestion reads `*.json` files in this directory. A file may contain
an array of claims or `{ "claims": [...] }`. Claims must satisfy the
`NightSignalClaim` contract in `lib/nightSignalClaims.ts`.

Automation only produces a review branch. A claim cannot affect route ranking
unless it is approved and either corroborated by another source or marked as a
manual review. User route requests read the reviewed snapshot and never run a
live third-party search.

Public claim artifacts expose only the non-personal review authority category
(`operations`, `editorial`, or `automated`). Individual reviewer identity is
not stored in committed candidates, database claims, or public snapshots.
