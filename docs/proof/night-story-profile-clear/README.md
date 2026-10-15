# Night Story profile-clear redaction

15 October 2026. Branch based on main `599252af3019f3776b5d78d297fae2d871fbd87f`.

## Reproduction

The existing profile-clear route test was extended with the former display name
in the host's caption, Story title and summary. Before the fix, the real DELETE
handler and in-memory stores produced:

| Field | Before fix | After fix |
| --- | --- | --- |
| Caption | Great night with Jordan and a friend | Great night with a friend and a friend |
| Title | Orbit with Jordan | Orbit with a friend |
| Summary | Jordan joined us | a friend joined us |

Command: `npm test -- __tests__/profileDeleteRedaction.test.ts --maxWorkers=1`.
The extended regression failed before implementation on the surviving caption.
After implementation all four contributor/consent-only and prior-withdrawal cases passed, including title,
summary, public Story, recap, repeated clear, wrong caller and unchanged private
source caption assertions. Authentication is a test boundary; this is a route
handler integration test, not a browser or real-account acceptance run.

## Database proof

`npm test -- __tests__/nightStoryProfileClearEffective.test.ts --maxWorkers=1`
starts the repository's PostgreSQL 16 harness, applies its platform fixture and
all 195 migrations, then exercises the real SQL function and access rules.

Fourteen tests passed. They cover accepted, already-withdrawn and consent-only
relations, per-Story scope, repeated clears with a second name, populated image
state, wrong and anonymous caller refusal, failed name-storage rollback,
browser SELECT/DELETE/RPC refusal, Story/account cascades, re-apply and rollback.

Independent review found an acceptance interleaving in the first implementation.
A database trigger in the regression accepts a pending invitation during name
capture. The old two-statement version left one withdrawn contribution without
a matching retained name. The revised withdrawal CTE supplies the IDs actually
withdrawn, and the same probe reports zero such rows. No production trigger is
installed by the probe; the harness removes its test trigger after the assertion.

Review also found a real transaction race: acceptance and consent writes did
not lock the profile row. Both service-only mutation RPCs now take the same
profile lock as clearing. Two concurrent-session PostgreSQL tests cover these
interleavings.

A further ordered probe found that an approved consent without a contributor
row survived profile clearing. Its later withdrawal then lacked a retained
name. The regression failed in both the database and the real DELETE/public
reader integration. Clearing now withdraws every existing consent owned by the
profile and retains the name in the same transaction. Both withdrawal orders
pass, and private source captions stay unchanged. The database also removes
the cleared owner's publication joins. This includes historical consent-only
relations without changing another owner's consent.

## Scope and rollout

This fixes `DELETE /api/profiles/[handle]`, the profile-clearing path. It does
not certify full auth-account deletion's Night Story behavior. The new table's
account FK deletes redaction names on full auth deletion.

Apply migration 0178 before deploying the application. An absent RPC refuses
profile clearing. Private-name reads request an exact row count; a truncated
answer refuses public emission rather than leaving some names visible. A failed private-name read refuses public emission for a
Story with a departed contributor. There is no unsafe fallback.

Names already erased by earlier profile clears cannot be reconstructed by this
migration. No names are inferred or backfilled from another person's text.

Retained names and handles are service-only, scoped to affected Stories, and removed with
the Story or auth account. They are absent from contributor/profile DTOs.
Private source Moments are never rewritten. Rollback removes redaction
material, so restore the earlier application deliberately and assess the
resulting disclosure risk before applying it.

## Resource use

Dependency installation and focused tests used a 512 MiB Node heap. Focused
Vitest commands used one worker, and the PostgreSQL host budget was one cluster.
Full verification uses the repository's bounded worker configuration with a
768 MiB Node heap per process. Memory samples were checked between commands.
No app build, production database mutation, deployment, or cleanup of existing
work was performed for this proof.

Additional regression: a private-name read returning one of two matching rows
returned a public source before the completeness guard. It now answers
`unavailable`. The public Story/recap and profile-clear suites pass 33 tests
with that guard, including both current and retained-name cases.

The privacy notice and terms describe the retained names and their lifetime.
The legal-page suite passed 37 tests after the disclosure changes.

## Local verification

`NODE_OPTIONS=--max-old-space-size=768 PUBMAX_PG_MAX_CLUSTERS=1 npm run verify:no-mistakes`
completed successfully. Coverage passed 22,049 tests across 1,828 files, with one
optional Context.dev live-provider test skipped without its API key. PostgreSQL
passed 564 tests in 58 suites plus 10 serial harness tests. The gate's final-head
run must validate the later completeness guard as well. Its focused route,
reader, ownership, store and legal suites passed 268 tests, and final TypeScript
checking passed. Lint reported zero errors and 17 existing complexity warnings.
Freshness passed with three credential-dependent feeds explicitly unresolved;
this does not prove those live feeds healthy. The dependency audit reported no
unwaived high or critical finding.

After the consent-only repair, all 20 focused database and DELETE integration
tests passed. TypeScript and scoped lint passed. The final-head publication
gate must still run the complete verification command.

## Further review regressions

A pending invitation with no consent row did not retain its identity. A profile
without a display name also had no durable redaction identity. New SQL and
DELETE integration cases failed before repair, then passed after capturing the
handle and any display name for every existing contributor or consent relation.
Invited participation is withdrawn too. Memory clearing now removes the same
owned publication entries as the database, without changing source Moments.
The focused database and DELETE integration run passed 25 tests.

Retained identities remain in the public redaction set after re-invitation,
acceptance or consent re-approval. Rejoining an affected Story does not undo
its earlier clear. The privacy notice and terms describe this behavior.

The request boundary is a completed profile clear: public reads begun after
the successful DELETE must redact. An overlapping request that already read
the complete earlier state can return that earlier state. No system can recall
text already read or buffered for delivery. A single database snapshot would
not eliminate that case. The regression and rollout claims do not promise
revocation of responses already in flight or copies already received.

After the pending-invitation and memory publication repair, seven related
suites passed all 114 tests. TypeScript and scoped lint passed. Final-head full
verification remains the publication gate.
