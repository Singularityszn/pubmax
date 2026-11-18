# Crew removal correction runbook

A host can remove a member from one crew. After migration 0245, that person cannot ask to join that crew again.
The refusal is "not found", the same answer an unknown crew gets. Only a moderator can correct a mistaken removal.
There is no app screen or route for this. The operator runs one service-only SQL call.

## Before you start

1. Make sure the captain applied migration 0245.
2. Get the moderator's staff role ID. It is `SOCIAL_MODERATOR_STAFF_ROLE_ID`, and the role must be active and not revoked.
3. Make sure the moderator is not the removed person. The call refuses a moderator's own removal.
4. Write down the reason, for example the report or support message that shows the mistake. The reason must have 3 to 500 characters.
5. Get the crew ID from the report or the support message.

## Correct the removal

1. In the Supabase SQL editor, find the removed member. This query only reads.

   ```sql
   select member.id as member_id, member.state, profile.handle
   from public.social_crew_members member
   join public.private_social_accounts account on account.id = member.social_account_id
   join public.profiles profile on profile.id = account.profile_id
   where member.crew_id = '<crew id>' and member.state = 'removed';
   ```

2. Run the correction as the service role.

   ```sql
   set role service_role;
   select public.correct_social_crew_removal_admin(
     '<staff role id>', '<crew id>', '<member id>', '<reason>'
   );
   ```

3. Read the answer.

   | Answer | Meaning |
   | --- | --- |
   | `corrected` | The member is now `left`. The person can ask to join again, and every admission check applies. |
   | `unchanged` | The member was not removed. Nothing changed and no ledger row was written. |
   | `not_found` | The crew or the member does not exist, or the member is in another crew. |
   | `forbidden` | The moderator is the removed person. Ask another moderator. |
   | `gone` | The removed person deleted their account. Nothing changed. |
   | `invalid` | The reason is too short or too long. |
   | error `staff required` | The staff role is not an active moderator. |

The correction does not give the person a place. No message goes to the host or the person. If the person contacted support, tell them that they can ask to join again. Do not name the host, the other members or any block.

## The ledger

Each correction writes one row to `public.social_crew_removal_corrections`: the crew, the subject's auth user, the member, the account, the reason, the staff role and the moderator's display name.

What the ledger does today:

- Only the service role can read the ledger or add a row. The service role cannot change or delete a row.
- When the subject deletes their account, their rows are deleted in the same transaction.
- When the crew is deleted, its rows are deleted. Deleting a crew-bound Plan deletes its crew (see below).
- The subject's own-record export ships with this change. It includes the correction outcome, without staff details or reasons.

Production use still requires the captain's migration approval and the apply-time privilege and trigger-order checks. The unused 0071 identity writer remains a separate operational hold.

## Deleting a crew-bound Plan

No app screen or route deletes a Plan. When an operator must delete one, use this one transaction and no other order. It locks the crew row, then the Plan row, then deletes the Plan. An admission also locks the crew row first, so the two wait for each other instead of deadlocking. A plain `delete from public.plans` can deadlock with an admission in flight.

```sql
begin;
select id from public.social_crews where plan_id = '<plan id>' for update;
select id from public.plans where id = '<plan id>' for update;
delete from public.plans where id = '<plan id>';
commit;
```

The delete removes the Plan's seats, its crew, member rows, join requests, invitations and correction rows. The seat reference from member rows is checked at commit, so this delete completes. A delete of one seat row that a member row still uses fails at commit. A delete of one member row that a request or invitation still names fails at once.

## Deleted accounts' crew places

When an account is deleted, migration 0246 frees each crew place it held as a guest and cancels each crew night it owned. History stays: the guest's member row becomes `left`, the night's Plan becomes `abandoned`, and that crew's pending requests and invitations become `expired`. Suspended accounts and unbound legacy accounts are not touched.

The deletion service runs the release after the auth row is deleted, and again when the same delete is repeated. Each call processes at most 20 pending crews across deleted accounts. Later calls continue pending cleanup. A failed call can leave counts or cancellation stale until another call completes. Admission and invitation paths that pass the host pre-checks release their crew's departed members before participant locks. A departure during those waits can remain pending until the next sweep or admission.

When the service logs `account.delete_crew_release_failed` or `account.delete_crew_release_batch_full`, check pending cleanup with the query below. A full batch means more crews may be pending. It does not prove that any remain.

```sql
select member.crew_id, member.role
from public.social_crew_members member
join public.social_crews crew on crew.id = member.crew_id
join public.plans plan on plan.id = crew.plan_id
join public.private_social_accounts account on account.id = member.social_account_id
join public.profiles profile on profile.id = account.profile_id
where member.state = 'active' and account.supabase_user_id is null and profile.tombstoned_at is not null
  and (member.role <> 'owner' or plan.status in ('draft', 'ready', 'active', 'ending'));

set role service_role;
select public.release_departed_social_crew_places(100);
```

The sweep locks the selected crew rows before it changes any Plan. It skips busy crews. It changes their Plans in Plan ID order, the order an account deletion locks the Plans it owns. A `"crews": 0` answer can therefore mean pending crews are busy. Check the pending query after each call. Cleanup is complete when that query returns no rows. Rolling back 0246 stops new releases. It does not restore freed places or cancelled nights.

## Host attendance (0247)

A host or co-host of an open crew marks each guest (role `member`) Here or Not here, from London midnight on the night's day until 12 hours after the start. A change must name the current revision. After the close, only a moderator can change a mark. There is no app screen for moderators. A guest reports a wrong mark with "Report this mark" in the attendance panel. The report names the exact mark and revision. It does not go to the Social safety queue in `/admin`, so read it here.

A moderator with any member row in that crew, in any role or state, cannot decide its disputes. Roles change in place, so a former co-host looks like a guest. The calls also refuse the crew's owner, anyone who marked in it, the guest, and the moderator whose own mark an open report disputes. Ask a moderator who was never in that crew.

1. Read the open reports that you may decide. The list leaves out every report you may not decide. Each entry names `crewId`, `nightStartsAt`, `memberId`, `memberState`, `subjectHandle`, the `disputed` revision, state and time, who recorded it (`hostHandle`, or `staffDisplayName` for a moderator), and the `current` revision.

   ```sql
   set role service_role;
   select jsonb_pretty(public.read_social_crew_attendance_reports_admin('<staff role id>', 50));
   ```

   To check a member without a report, read each member's current unexpired mark. This query only reads. It works after a block, a suspension or a removal, when the host's read no longer lists the guest. A revision of 0 means no unexpired mark. The service role cannot read the attendance tables, so `reset role` first returns to the SQL editor's own role. Step 2 sets the service role again.

   ```sql
   reset role;
   select member.id as member_id, member.state, member.role, profile.handle,
     coalesce(mark.revision, 0) as current_revision, mark.state as mark, mark.actor_kind, mark.expires_at
   from public.social_crew_members member
   join public.private_social_accounts account on account.id = member.social_account_id
   join public.profiles profile on profile.id = account.profile_id
   left join lateral (
     select attendance.revision, attendance.state, attendance.actor_kind, attendance.expires_at
     from public.social_crew_attendance attendance
     where attendance.crew_id = member.crew_id and attendance.subject_account_id = member.social_account_id
       and attendance.expires_at > now()
     order by attendance.revision desc
     limit 1
   ) mark on true
   where member.crew_id = '<crew id>';
   ```

2. Decide as the service role. Use `memberId` and the `current` revision from step 1. Give the state that is right: the other state changes the mark, and the same state keeps it (`unchanged`). Either answer closes the open reports about that member's marks in that crew.

   ```sql
   set role service_role;
   select public.correct_social_crew_attendance_admin(
     '<staff role id>', '<crew id>', '<member id>', 'attended' or 'absent', <current revision>, '<reason>'
   );
   ```

The correction works for a member who is `active`, `left` or `removed`. It never changes the member row, so a removed guest stays removed.

| Answer | Meaning |
| --- | --- |
| `corrected` | A new revision records the mark, the moderator and the reason. No one is notified. |
| `unchanged` | The mark already has that state. |
| `stale` | The revision is not the current one. Read it again. |
| `forbidden` | The moderator has been in that crew, owns it, marked in it, is the guest, or made the mark that an open report disputes. Ask another moderator. |
| `expired` | The record is past its 30 days. |
| `not_found`, `gone`, `invalid` | No such member, the account was deleted, or the reason or state is not valid. |

Marks, corrections and the write receipts about them expire 30 days after the close. The app's reads, replays and exports stop at expiry, but the rows stay until the cleanup deletes them. Nothing schedules that. Run this until it answers `"deleted": 0, "receipts": 0`. Each call deletes at most 1,000 of each.

```sql
set role service_role;
select public.purge_expired_social_crew_attendance(1000);
```

A report goes with the mark it disputes: at expiry the list leaves it out, and the cleanup deletes it with the mark. Deleting a guest's account deletes their marks, their reports and the receipts about them in the same transaction. Rolling back 0247 deletes every mark, every report and every attendance receipt. It stops while rows exist, unless the session sets `pubmax.crew_attendance_discarded` to the exact row count.

## Blocks between accepted members (0248)

Applying 0248 takes `auth.users` and the three Social tables in SHARE ROW EXCLUSIVE mode through the backfill. It waits for busy writers. Sign-ins and other writes to `auth.users` can wait until the migration commits.

When one person blocks another while both hold a place on the same crew night, a private case opens for a moderator. The night continues. Nobody loses a place or a seat, and nobody is notified. No attendee, host or co-host can read the case. Guests and co-hosts keep the private **Leave this crew** action, which frees their place at once. Owners cannot leave. A block never pauses or cancels the night.

A later person who is blocked either way with an accepted member cannot join. Request, approval, invitation and invitation acceptance all answer "not found", as for an unknown crew (0245). The earlier accepted member keeps the place.

There is no app screen for these cases. The `/admin` safety queue is bound to one configured moderator, so it cannot leave out a moderator who is tied to the crew. Use these service-only calls. The code sends no alert and assigns no operator. A case that nobody decides leaves the queue when the night closes.

Before a hosted pilot launches, the captain must name an independent operator and a backup and confirm the coverage in the approved pilot plan. From publication, the operator must check the pre-event queue at least daily and resolve cases before the event or cancel that occurrence for an independent safety reason. The pilot plan also requires live coverage and checks at least every four hours during the post-night choice window. Without confirmed coverage and a backup, the occurrence must not launch. This migration does not establish that staffing or activate a schedule.

A guarded operator call to cancel one occurrence is not implemented. The legacy Plan status call refuses Crew-bound Plans. Before launch, provide and verify that operator path. Until then, keep the occurrence unlaunched. The cancellation race proof uses a direct operator status update, not an approved launch procedure.

1. Read the open cases that you may decide. The list leaves out every case of a crew that you own, have any member row in (in any role or state), or have a pending request or invitation for. It also leaves out every case where you and either person are blocked either way. It leaves out a case after either person leaves or is removed, after every block between the two is lifted, after the night closes or is cancelled, and after expiry. Each entry names `caseId`, `crewId`, `nightStartsAt`, `expiresAt` and `people`: the two people, earlier accepted first. Each person has `memberId`, `handle`, `role`, `joinedAt` and `blocksOther`. `blocksOther` says whether that person blocks the other one now. The list does not say who opened the case.

   ```sql
   set role service_role;
   select jsonb_pretty(public.read_social_crew_block_cases_admin('<staff role id>', 50));
   ```

2. Decide. Keep both places with `'kept'` and no member. Or remove one of the two people with `'removed'` and that person's `memberId`. A removal works as a host removal does: that crew bars the person, their seat ends and the roster revision moves. The owner cannot be removed. The reason must have 3 to 500 characters.

   ```sql
   set role service_role;
   select public.decide_social_crew_block_case_admin(
     '<staff role id>', '<case id>', 'kept', null, '<reason>'
   );
   select public.decide_social_crew_block_case_admin(
     '<staff role id>', '<case id>', 'removed', '<member id>', '<reason>'
   );
   ```

| Answer | Meaning |
| --- | --- |
| `decided` | The case is closed with your decision, your name and your reason. No one is notified. |
| `unchanged` | The case was already decided with this decision and this person. The original moderator and reason stay recorded. This call adds no audit record or new reason. |
| `already_decided` | The case was already decided differently. The answer names that decision. Nothing changed. |
| `forbidden` | You are tied to the crew or to either person, as step 1 describes. Ask a moderator with no such tie. |
| `stale` | The case is no longer live: a person left or was removed, every block between them was lifted, or the night closed or was cancelled. Nothing changed. Read the queue again. |
| `invalid` | The decision, member or reason is not valid. The member must be one of the two people, and not the owner. |
| `expired`, `not_found` | The case expired, or the case, its crew or one of the two accounts was deleted. |
| error `staff required` | The staff role is not an active moderator. |

The decision checks committed eligibility at its live-rule statement. An overlapping unblock or standalone cancellation can commit first while the removal still completes. Such overlapping actions use the serial order of that eligibility read.

To lift a mistaken removal, use the correction in "Correct the removal" above. A new block after a decision opens a new case.

### When the host is one of the two people

A case can name the crew's owner, for example when a guest blocks the host. You cannot remove the owner, and a host never sees the case. The guest keeps **Leave this crew**, and keeps **Report** on the crew page for the host. That report goes to the `/admin` safety queue. When the configured `/admin` moderator owns the crew or has a member row in it, do not let that moderator decide the report. A moderator who was never in that crew reads it with `read_social_report_queue_admin` and decides it, and a suspension (`set_social_account_suspension_admin`) is global. Cancel the night only for a reason beyond the block itself.

### Retention

A case receives a fixed expiry when it opens, set to 30 days after the planned close (start plus 12 hours). A later Plan start change does not move that expiry. The retained case and decision support removal reviews and appeals. Only privileged operators can inspect that history directly. The service queue shows open cases only. From expiry the queue and the decision refuse it, but the row stays until the cleanup deletes it. Nothing schedules the cleanup. Run this until it answers `"deleted": 0`. Each call deletes at most 1,000 expired cases and cases whose crew is gone.

```sql
set role service_role;
select public.purge_expired_social_crew_block_cases(1000);
```

Deleting either person's account deletes their cases in the same transaction. Deleting the crew's Plan deletes its cases. A block that lands while the Plan is being deleted can leave a case without a crew. No call reads it. Only the cleanup above deletes it, so it stays until an operator runs the cleanup. The own-record export does not include cases. Rolling back 0248 deletes every case and decision. It takes `social_blocks`, `private_social_accounts`, `social_crews` and the case table without waiting. If one is busy, it stops with `could not obtain lock` and changes nothing. Reads and writes of those tables wait while the rollback holds its locks. It stops while cases exist, unless the session sets `pubmax.crew_block_cases_discarded` to the exact row count. A removal a moderator decided stays after the rollback.

## Rollback

Roll back 0248 before 0247, 0247 before 0246, and 0246 before 0245. The 0245 rollback refuses to start while the 0246 release function or the 0248 case table exists.

Rollback of 0245 waits for `auth.users` while it holds nothing. Corrections, admissions, deletions and plan joins that hold an auth row finish first. It then takes the crew tables, `plan_crew_members`, `social_blocks`, `private_social_accounts` and the ledger without waiting. If one is busy, it stops with `could not obtain lock`. Run it again, ideally while Social is frozen. Sign-ins and Social writes wait while it runs. A nonempty ledger requires an acknowledgement of its exact exported contents.

1. In psql, export the records and their acknowledgement in one query. Use a secure local destination.

   ```sql
   \pset format unaligned
   \pset tuples_only on
   set time zone 'UTC';
   with exported as (
     select coalesce(jsonb_agg(to_jsonb(correction) order by id), '[]'::jsonb) as records
     from public.social_crew_removal_corrections correction
   )
   select jsonb_build_object('records', records, 'acknowledgement',
     jsonb_array_length(records)::text || ':' || encode(sha256(convert_to(records::text, 'UTF8')), 'hex'))
   from exported
   \g /secure/crew-removal-corrections.json
   ```

2. Read the acknowledgement from that file. In the rollback session, set that exact value.

   ```sql
   set pubmax.crew_removal_corrections_exported = '<count>:<SHA256 from the exported file>';
   ```

3. Run the rollback. If any record changed after export, it stops even when the count is unchanged. Export again before retrying.

The rollback also restores the seat reference from member rows to `ON DELETE RESTRICT`. After it, a crew-bound Plan cannot be deleted again.

Migration 0245 also deletes private Crew write receipts that belong to deleted accounts, both those left before it was applied and each one when an account is deleted later. The rollback cannot restore deleted receipts. After a rollback, account deletion leaves receipts behind again, which the published privacy text does not allow, so reapply 0245 or replace that protection before deletions resume.

The migration role does not own `auth.users`, so it cannot drop a trigger there. The rollback leaves `lock_social_accounts_on_auth_user_delete` in place and makes its function return at once, so account deletion takes no account lock. Reapplying 0245 reuses that trigger only when it is exactly the 0245 trigger. When a different trigger has that name, the reapply stops, and the owner of `auth.users` must remove it.
