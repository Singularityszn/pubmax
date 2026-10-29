# Hosted outings

Hosted outings are adult-only groups at listed London venues.
An operator creates a draft and assigns an active named moderator.
Public signup stays closed until the venue is confirmed and enrollment is enabled.

## Before enrollment opens

1. Confirm the venue booking, date, capacity and named moderator outside the app.
2. Review the migration label against all open migration branches.
3. Have the captain apply migration 0202 and retain its rollback.
4. Have the captain enable `PUBMAX_HOSTED_OUTINGS_ENROLLMENT_ENABLED` after the operational checks.
5. Publish the confirmed draft through the host controls.

The application does not enable that setting.
A draft published while the setting is disabled remains closed.
After the captain enables enrollment, the operator can confirm the venue again to open that waiting list.
No migration or deployment occurs through this feature.

## Attendance

A signup records only a declared pace and spending ceiling.
Every signup starts on the waiting list.
The proposal follows signup order and excludes blocked pairs.
The operator approves a group before its members can confirm.
A member can cancel their own place.
Cancellation does not automatically confirm someone from the waiting list.
The operator must approve the replacement group.

Approval locks the outing row, checks its revision and reserves capacity in one transaction.
Confirmation checks blocks and the moderator again.
The server never substitutes process memory for durable attendance.

## Communication and privacy

Approved attendees can read the host's outing message.
Confirmed attendees can see unblocked confirmed handles and choose to visit their existing profiles.
An outing does not create a Social connection, Plan membership or private conversation.
Existing Social profile controls own connection consent and blocks.

An attendee can send a private report to the outing's named moderator.
Other attendees cannot read the report.
The named moderator can mark it reviewed.
A confirmed attendee can rate a completed outing.

Browser roles cannot read or write the hosted tables directly.
The existing Social gate checks account ownership and adult eligibility before the API runs.
The account export contains only the caller's attendance, reports and feedback.
Account deletion removes those records through their auth-user references.

## Operational limits

No venue booking or named moderator is configured by this change.
No signup notification, email delivery, external messaging or payment is included.
Host messages appear when attendees load or refresh the outing.
The host must review reports in the outing page.
The rollback permanently removes hosted attendance, reports and feedback.
Existing Plans, Social Crews, messages, blocks and connections remain in their existing systems.
