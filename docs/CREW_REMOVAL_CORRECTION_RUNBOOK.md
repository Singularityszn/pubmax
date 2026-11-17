# Crew removal correction runbook

A host can remove a member from one crew. After migration 0243, that person cannot ask to join that crew again.
The refusal is "not found", the same answer an unknown crew gets. Only a moderator can correct a mistaken removal.
There is no app screen or route for this. The operator runs one service-only SQL call.

## Before you start

1. Make sure the captain applied migration 0243.
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
- When the crew is deleted, its rows are deleted. A crew-bound Plan cannot be deleted today while its member rows reference seats.
- The subject's own-record export is built outside migration 0243. It is not live yet.

Export, the Plan deletion change and the other lifecycle items are open release holds, owned outside migration 0243. Do not run a correction in production until the captain closes them.

## Rollback

Rollback of 0243 first locks the crew tables, then `auth.users`, then the ledger, so sign-ins and Social writes wait until it commits. It counts the ledger rows. While the ledger has rows, the rollback stops.

1. Export the rows and note how many there are.

   ```sql
   select * from public.social_crew_removal_corrections order by created_at;
   ```

2. In the session that runs the rollback, first run this, with the exact count from step 1:

   ```sql
   set pubmax.crew_removal_corrections_exported = '<row count>';
   ```

3. If a correction lands after your export, the count changes and the rollback stops. Export again and use the new count.
