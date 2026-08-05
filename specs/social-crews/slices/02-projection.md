# Slice 2: projected reads

## Contract

Crew list and Crew Page reads expose only current authority. Private denial is
`404`. A Mutual may receive a narrow friends preview and Join Request state.
Only an active member who remains a current Mutual with owner receives full Plan
state.

Title, start time, nullable Night Area, phase, and route revision are projected
from the Planned Night. `authorityRevision` comes from Crew authority storage
and has no route meaning.

## Seam

`projectSocialCrewRead(raw, viewer)` is the only raw-row to browser boundary.
`SocialCrewReadDTO` is the only route output. Cursors bind HMAC signature to
viewer profile ID, lane, timestamp, and row ID.

## RED cases

- Preview excludes route, exact Venue, identities, counts, chat, protected IDs,
  Check-ins, and Safe Home.
- Current membership without owner friendship gets `404`.
- A block clears protected DTOs on next refetch.
- Dependency failure returns `503`, not empty or `404`.
- Actor A cursor fails for actor B.
- Legacy Plan tokens never return member projection for a Crew-bound Plan.

## Playable checkpoint

Owner sees full page. Uninvited Mutual sees preview. Pending requester sees the
same preview plus pending state. Stranger, blocked member, and private denial see
the same not-found surface.

## Verification

Run DTO snapshot, route, cache-header, cursor, and legacy-firewall tests. No
visual proof is required before Slice 8.
