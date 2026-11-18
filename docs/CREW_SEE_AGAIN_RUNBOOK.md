# Private see-again

Migration 0250 adds private friendship reconnection to the existing Crew page.
The release is held. No cron schedule, deployment or shared migration apply is authorised by this change.

## Release holds

1. The captain must approve the named migration and deployment separately.
2. The coordinator must verify the latest integrated source and generated database types.
3. The captain must confirm the independent moderator, backup, venue agreement and real pilot occurrence.
4. The cancellation owner must complete issue 3001 before hosted launch.
5. An operator must verify the expiry executor and failure alert before launch.
6. Dating must remain closed until stage D has explicit occurrence labelling, informed participation consent and pilot acceptance.

This change stores only `friendship` context. Dating requests receive the same neutral database acknowledgement without writing.
There is no approved occurrence metadata or stage D release authority to enable dating here.
Do not derive a label from a Crew name, sex, pub taste, location or purchases.
The root coordinator owns the council review, publication and release decisions.

## Access and consent

The protected route is `/api/social/crews/[crewId]/see-again`.
The existing Social gate verifies an active adult account.
SQL checks both accounts again for each paired read or write.
Stored DOB decides adult status when present. A recorded adult assertion is the fallback.
DOB and assertion details never enter the private roster or outcome payload.

Both people must remain accepted participants with current host-attested attendance for the same occurrence.
The existing Crew owner, active host account and Plan seat authority must also remain valid.
A host block or loss of host authority revokes affected connections without restoring them after reversal.
Hosts and co-hosts cannot be attested by the existing attendance writer, so they cannot choose or read outcomes.
The roster is alphabetical and has no choice counts or popularity ordering.
A person explicitly consents to friendship before choosing.
A write returns only `{ "ok": true }`. A same-context mutual appears only on the two participants' next authorised read.
Wrong context, no choice, withdrawal, expiry and invalidation give no hint about the other person's choice.

The private component refreshes on focus, visible return and the window boundary.
It rechecks the server before a choice, withdrawal or Add mate action.
A same-account refresh keeps the current section and disables its actions.
An action restores keyboard focus to its result unless the person moved focus elsewhere.
Failed reads remove previous controls and offer retry.
Account changes remount the panel and abort old requests.
No follow, message, notification, email, push or realtime channel is created.
The separate Add mate confirmation explains public follower and following lists before navigation.
Existing mutual-follow and safety rules still own messages.
The existing ReportPerson entry remains available on the Crew page and private roster.

## Transaction order

Paired reads, choices and withdrawals take these locks:

1. The Crew row.
2. Every active roster auth row, in auth ID order, using KEY SHARE.
3. Participant account advisory locks, in account ID order, using the 0245 helper.
4. Stable unordered pair advisory locks.
5. The pair row, before a guarded state transition that names its current revision.

Roster locks are taken once. A read cannot accumulate account locks in display order.
The pair key uses both account IDs and is stable across different Crews and contexts.
Every live eligibility check runs after the locks wait.
Leave, host removal and visibility changes take roster auth/account locks before member, seat and receipt writes.
Moderator removal takes both participant auth/account locks before its case row.
Membership is checked again under the Crew lock.

Block writes already take both account locks through 0245.
Suspension and auth deletion already take their subject account locks.
Attendance correction holds Crew, subject auth and subject account, in that order.
Their AFTER triggers take only pair locks and invalidate affected rows in stable pair order.
They never acquire an additional lower-ordered participant account.
Those subject account locks exclude paired transactions involving that subject.
Crew-scoped raw visibility and Plan status writes take only canonical pair locks.
Visible-connection export reserves its complete pair set in canonical order across all selected Crews.
Block and suspension invalidation spans every Crew for those people.
Unblock and reinstatement do not revive an invalidated pair.

Membership changes hold the Crew row and acquire no account lock from an AFTER trigger.
Migration 0250 evolves the existing moderator case writer to take both ordered participant accounts after auth and before the case row.
Its live blocker check runs after those locks wait, so a new block direction requires a fresh acknowledgement.
This pre-close moderation writer also serialises with post-night operations involving the same people on other Crews.
The rollback restores the exact 0248 body. The 0248 forward file stays unchanged.
Host removal and departure cleanup retain the Crew exclusion before pair invalidation.
An unrelated block or mute against a profile without a product account invalidates no pair.
Mute inserts take ordered account locks before their invalidation trigger.
SQL reads current age evidence after the participant locks wait.
Existing identity and assertion writers retain their own order.
No identity-row trigger acquires an account lock, which would invert deletion locks.
Account rebinding takes no new account lock. It follows the existing provisioning order.
Account unbinding deletes private pairs and cascades their choices before deletion commits.
Crew deletion cascades every pair and direction.
No cleanup lag can restore access because reads check the current account, membership, attendance revision and safety state.

## Retention and export

The database attendance window owns the 12-hour close.
Choices open there and close 72 hours later.
A withdrawal cannot be offered again for that occurrence, pair and context.
The other person can save their own choice on a terminal pair, without forming an outcome.
Their saved-choice acknowledgement cannot reveal that somebody else withdrew.
If formation won the transaction race, withdrawal dismisses the outcome for both people.
Every directional choice and terminal marker expires at choice-window close, whether a mutual formed or not.
Only a currently visible mutual connection may remain for up to 30 days after formation.
Its expiry is also capped by the attendance authority expiry.
Dismissal clears formation metadata and keeps only a short terminal marker until choice-window close.
After that deadline, dismissal deletes the connection synchronously.
Safety invalidation follows the same short marker rule and immediately denies access.

The account export has an owner-only `crewSeeAgain` lane.
It contains the owner's selected member ID, context, own choice and choice/withdrawal time.
It omits formation time and pair-derived expiry because they disclose outcome information.
That directional lane never contains the other person's choice or a hidden mutual outcome.
The separate `crewSeeAgainConnections` lane contains only currently visible connections.
It reuses the authorised participant read under ordered Crew, auth, account and pair locks.
Its fields are only Crew ID, member ID and friendship context.
Own choices remain available to suspended owners under the existing account-export policy.
Suspended owners receive no visible connections.
It is separate from the paired product read. Export failure refuses a complete export.
Account deletion and Crew deletion remove these records synchronously.
There is no moderator choice reader, case access bypass or direct service-role table grant.

## Export privacy

The captain approved one common choice-window deadline for matched and unmatched directions and terminal markers.
Exports contain only the person's own choice, subject member, context and own action times.
They omit outcome state, formation time, expiry and hidden-mutual fields.
The other person's choice or dismissal cannot change the person's export before the common deadline.
After that deadline, expired choices are absent even while physical cleanup lags.
Visible connections have no directional export archive and are deleted when dismissed after the choice window.
Safety invalidation and account or Crew deletion retain their stronger immediate access and deletion guards.

## Proposed executor, held for approval

Exact proposed Vercel entry:

```json
{ "path": "/api/cron/expire-see-again", "schedule": "0 * * * *" }
```

No entry is added to `vercel.json` by this change.
The route uses `assertCronRequest` and the existing `CRON_SECRET` credential.
One call runs one bounded database batch.
The 1,000-row bound counts the pair and its cascade-deleted directions together.
At most 333 pair candidates and 999 physical rows are processed in one batch.
Expired directions are deleted independently while a visible connection remains.
Cleanup locks all selected Crews, then auth rows, accounts and pairs in stable order.
Busy Crew rows are skipped. The next verified execution must handle the remaining backlog.
Expired records are unreadable before the sweep runs.
A non-success response or exception produces HTTP 503 and the log marker `[expire-see-again]`.
Logs contain no participant, pair, Crew or choice identifiers.

Before the captain enables the schedule:

1. Assign the executor and failure-alert owner.
2. Verify authenticated success and unauthenticated refusal on an approved environment.
3. Verify a retained expired fixture is deleted and an unexpired fixture remains.
4. Verify a forced executor failure reaches the named operator's alert destination.
5. Measure the expiry backlog and confirm hourly bounded throughput clears it within the target.
6. Record the executor, UTC times, source head, results and alert receipt in the release evidence.

No 24-hour physical-deletion guarantee applies before this executor and its alert are running and verified.
Attendance and safety-case cleanup remain the separate jobs in the existing removal runbook.
Their executors must also be verified before a retention claim covers those records.

## Freeze and rollback

`PUBMAX_SOCIAL_FREEZE=social` rejects new choices through the existing write guard.
Authorised reads, withdrawals, reporting, blocks and account deletion retain their policy.
`PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` remains the separate existing launch rollback.
This document authorises no setting change.

Stop choice writers before applying the 0250 rollback.
Roll back 0250 before 0248, 0247, 0246 or 0245.
The rollback takes auth first, then the application tables without waiting.
It refuses a non-empty private store unless the operator acknowledges its exact combined pair/direction row count.
Use the session setting `pubmax.see_again_discarded` with that count only after the captain approves discarding those records.
The rollback permanently deletes every retained choice, tombstone and outcome.
It restores no deleted account data and changes no previous forward migration.
