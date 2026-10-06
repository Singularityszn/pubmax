# Permission matrix

What each actor may do with a private Plan, a Social Crew, a private
conversation and its attachment, a private Moment and its upload object, a
photo tag, a save, a price observation and its confirmation, moderator actions,
account deletion and the data export. The executable owner is
`__tests__/permissionMatrixEffective.test.ts` (run by `npm run test:rls`): it
boots PostgreSQL 16 plus PostgREST, applies every migration in production
order, and asserts every cell below at the API route and, where a browser JWT
could reach the table, at the table. Change a policy and change this file in
the same commit.

**Why the route door carries the weight.** Astra's delta audit (6 September
2026, F07) read the Supabase advisor and reported `rls_enabled_no_policy` on a
set of tables that are service-mediated by design, the Social Crew family among
them. A table with RLS on and no policy is refused to every browser role, which
is the strongest table answer there is; what it does not say is whether the
route in front of it gates correctly, because the route holds the service-role
key and RLS never runs for it. The answer to that advisory is not a policy. It
is this file, asserted per role, per resource, with reads and writes separated.

**Default-deny tables (migration 0068, unchanged by 0159).** These tables carry
RLS plus an explicit `*_client_deny` policy for `anon` and `authenticated`
(`using (false)`), with grants revoked from browser roles. Reads and writes go
through `/api/*` on the service-role path only; the matrix cells below are the
proof, not a second policy. The closed list is:
`plan_invites`, `plan_constraints`, `plan_route_proposals`, `plan_votes`,
`plan_vote_requests`, `plan_vibe_votes`, `plan_vibe_vote_requests`,
`plan_actions`, `plan_completions`, `rounds`, `round_members`, `round_stops`,
`round_spends`, `round_price_line_charges`, `community_price_reports`,
`pint_drop_reports`, `pint_drop_reactions`, `pint_drop_comments`,
`crawl_story_stops`, `rate_limits`, `push_tokens`, `social_oauth_states`,
`analytics_event_receipts`, `email_subscribers`, `feed_freshness`,
`weather_snapshots`, `weather_recommendations`, `area_demand`, `walk_route_legs`,
`venue_operators`, `operator_proposals`, `referral_invite_codes`,
`referral_erasure_blocks`, `referral_edges`, `referral_qualification_events`,
`pro_feature_unlock_ledger`, `drink_ratings`, `venue_ratings`, `price_confirms`,
and `night_signal_claims` (SELECT re-opened with an explicit approved-claim
predicate). `pub_presence` is service-mediated for writes; browser SELECT, when
granted, is the single non-expired read rule from 0159. Catalogue tables
`drinks`, `pub_heritage`, and `crawl_stories` are not on this list.

**Three rules every denied cell is held to.** A refusal answers the honest
status. It discloses no protected value, asserted over the whole serialized
body rather than over the fields a reader remembered to check. And it has no
side effect, asserted as a truth read of the row it was aimed at, taken either
side of the attempt. A resource id that names nothing must answer exactly as
one that belongs to somebody else, or the refusal is an existence oracle.

## Actors and doors

| Actor | How it reaches the app |
| --- | --- |
| anonymous | no bearer, or the anon key alone |
| owner (alice) | her Supabase access token; owns everything private below |
| invited participant (bob) | holds a pending Crew invitation, then a seat, then is removed |
| unrelated user (dave) | a signed-in account with no relationship to anything here |
| blocked user (carol) | a mutual follower of the owner whom the owner has blocked |
| guest (device RSVP) | a Plan seat with a capability token and no account behind it |
| capability | a Plan member token or invite token, which is not an identity |
| staff (moderator) | the `ADMIN_TOKEN` credential, never ownership |

Carol differs from Bob by the block alone: both are mutual followers of the
owner, so a cell that refuses Carol is measuring the block rather than a
missing follow.

Two doors. The API route runs through the service-role client and gates in
code. The table is what a browser JWT can read through PostgREST, gated by RLS.
The service role never reaches a client path.

## Cells

Allowed means the actor gets the private data or the write lands. Denied means
the honest refusal for that route (401, 403, 400 or 409) and no change.

| Cell | anonymous | user B | user A | capability |
| --- | --- | --- | --- | --- |
| Public venue evidence (`/api/venue/[id]`, visible drops and prices) | allowed | allowed | allowed | n/a |
| Read A's Plan (`GET /api/plans/[id]`, getin, recap) | preview only | preview only | preview only with a bare account bearer | host or guest member token: member state |
| Read A's Plan at the table (`plans`, `plan_stops`, `plan_crew_members`) | denied | no rows | own rows | seat bound to an account: rows while the seat is live |
| The seat token column (`plan_crew_members.token_hash`) | denied | denied | denied | denied |
| Edit A's Plan (`PATCH` stops, invite rotate, presence) | denied | denied | denied with a bare bearer | host token only; a guest may not rotate |
| Plan writes at the table | denied | denied | denied | denied |
| Invite acceptance (`POST /api/plans/[id]/join`) | invite required | one seat per account, spent invite refused | n/a | invite token as a bearer: preview and no edit |
| Removed member | n/a | preview at the route and no rows at the table, immediately | n/a | revoked token: preview, presence refused |
| Unfurler (`/api/plan-card`) | PNG from the preview only | same | same | same |
| List Night Memories (`GET /api/night-memories`) | 401 | own only | own only | n/a |
| A's Moments (`GET /api/night-memories/[id]/moments`) | 401 | empty list | own rows | n/a |
| Add a Moment to A's Memory | 401 | denied | allowed | n/a |
| Describe A's photo Moment (`PATCH alt-text`) | 401 | 403 | allowed | n/a |
| `night_moments` at the table | denied | no rows, no writes | own rows, no writes | n/a |
| A's upload object (`storage.objects` and the bucket paths) | invisible | invisible | invisible; only a server-minted signed URL serves it | n/a |
| Log a price (`POST /api/price-submit`, `POST /api/pint-drops`) | 401 | allowed under own actor | allowed under own actor | n/a |
| Confirmation | 401, no row; anon and authenticated inserts refused at the table | a matching figure confirms and `pintTrust` becomes `confirmed` | a different figure does not confirm and `pintTrust` stays `disputed` | n/a |
| Edit own price observation | n/a | newer-wins under own actor | newer-wins under own actor | n/a |
| Edit another's price row at the table | denied | denied | denied | n/a |
| Hidden rows and `actor` or `hidden_at` columns at the table | denied | denied | denied | n/a |
| Pint Drop and structured visit rows at the table, including an anonymous author's handle and moderator notes | denied | denied | denied | n/a |
| `community_prices.contributor_handle` at the table | denied | denied | denied | n/a |
| Moderator confirm, restore, review lanes, hide a price | 403 | 403 | 403 | `ADMIN_TOKEN` only |
| Delete account (`DELETE /api/account`) | 401 | own account only, whatever the body names | own account only | n/a |
| Export account data (`GET /api/account/export`) | 401 | own account only, whatever the query names | own account only | not an identity: 401 |
| Read A's PUBLIC profile card (`GET /api/profiles/[handle]`) | allowed | allowed | allowed | n/a |
| Read A's PRIVATE profile card | limited card | full for a mate, limited for anybody else | full: she owns it | n/a |
| Set who can see A's profile (`PATCH` `visibility`) | denied | 403, and the stored choice does not move | allowed | n/a |
| A's `profiles` row at the table, the choice included | denied | no rows | own row | n/a |
| Write A's `profiles` row at the table (handle, founding number, avatar moderation, report count, moderator note, or delete) | denied | denied | denied | n/a |
| Insert an ownerless `profiles` row at the table | denied | denied | denied | n/a |

## Cells added for the wider roles

The column here is the ROLE rather than the account, because these resources
are where the roles differ. Denied is the honest refusal plus no disclosure and
no side effect, as above.

| Cell | anonymous | unrelated | blocked | invited (pending) | member | removed member | owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raise a Crew over a Plan (`POST /api/social/crews`) | denied | denied, Plan untouched | n/a | n/a | n/a | n/a | host seat only |
| Read a Crew (`GET /api/social/crews/[crewId]`) | denied | denied | denied | denied | allowed | denied, immediately | allowed |
| Invite to a Crew | denied | denied | may not be invited | denied | denied | denied | allowed |
| Spend an invitation (`PATCH .../invitations/[id]`) | denied | denied, invitation stays pending | denied | allowed, once | n/a | spent invitation is not a way back | n/a |
| Change a Crew's visibility, remove a member | denied | denied | denied | denied | denied | denied | allowed |
| Crew tables and Crew RPCs at the table | denied | denied | denied | denied | denied | denied | denied |
| Read a conversation (`GET /api/messages/[id]`) | 401 | own empty thread; naming a participant is refused | same as unrelated | n/a | n/a | n/a | allowed to both participants |
| Send into a conversation | denied | denied, thread does not grow | denied | n/a | n/a | n/a | allowed |
| `conversations`, `messages` at the table | denied | no rows | no rows | n/a | n/a | n/a | participant rows, SELECT only |
| A message photo (`GET .../photo/[messageId]`) | denied | denied | denied | n/a | n/a | n/a | participant only |
| A reported message's attachment | gone from the thread and from the serving door, for its own participants |||||||
| Photo tag inbox (`GET /api/social/tags`) | 401 | own lane only | own lane only | n/a | n/a | n/a | own lane only |
| Read a Wanted (`GET /api/wanted`) | 401 | own list only | own list only | n/a | n/a | n/a | own list only |
| Read or write a Diary entry (`GET`, `POST /api/diary`) | 401 | own entries only; a body owner is ignored | own entries only | n/a | n/a | n/a | own entries only |
| `diary_entries` at the table | denied | no rows | no rows | n/a | n/a | n/a | own rows, SELECT only; a write is refused at the grant (0174) |
| Read a saved-pub list (`GET /api/saved-pubs`) | public by design |||||||
| Write a saved-pub list (`POST /api/saved-pubs`) | 403 on a claimed handle, 404 on a handle with no profile row (no row is minted) | writes to their OWN list, never the named one ||||| allowed |
| `saved_pubs` at the table | denied | no rows, and a write is refused at the grant (0172) ||||| own rows, SELECT only; a write is refused at the grant |
| A device RSVP (capability, no account) | reads the Plan it is a seat on; may not collaborate; names nobody at the inbox, the Wanted list, the export or deletion |||||||

## Findings from the first run

1. **A removed Plan member kept table-level SELECT** on the Plan, its stops
   and its crew through PostgREST for as long as the revoked seat still carried
   the account id. Migration `0070` moved every RLS helper into
   `pubmax_private` and the three Plan policies read
   `pubmax_private.rls_is_plan_participant`; migration `0124` then re-declared
   the helper with the `membership_revoked_at` check in `public`, a second
   function no policy calls. The API door was closed. Migration `0144` writes
   the check into the helper the policies read and drops the stray copy, which
   was also an exposed RPC in the public schema (the live isolated project
   answered `POST /rest/v1/rpc/rls_is_plan_participant` to the anon key).
2. **Refusals for a foreign Plan write read as 400** rather than 403 on the
   `PATCH` and presence routes, because validation and the capability lookup
   share one store result. Denied is denied; the matrix asserts 400 or 403.
3. **Account deletion takes the bearer alone.** The audit's expected policy
   names a reauthenticated owner; the route deletes the account the verified
   bearer names and reads no target from the body. Recorded as a policy
   question, not changed here.
4. **No data export route exists.** Superseded: `GET /api/account/export`
   shipped afterwards and is now a cell, gated on the caller's own bearer.

## Findings from the wider run (6 September 2026)

1. **Nothing in the wider matrix was a hole.** Every role and resource above
   answered as the design says it should, including the block, the removed
   member, the spent invitation and the service-only Crew RPCs. Four cells were
   written wrong on the first pass and the code was right; each is now recorded
   as the behaviour it actually has, because a matrix that asserts the wrong
   thing is worse than no matrix.
2. **The linked handle wins over the asserted one.** `resolveMessageHandle`
   prefers the handle the caller's account owns, so a signed-in caller naming
   somebody else's handle at the inbox or the saved-pub door is not refused:
   they act on their OWN list. Only a caller with no linked profile falls back
   to the asserted handle, and an anonymous caller asserting a CLAIMED handle is
   403. The cells assert both halves, because "refused" would have been the
   wrong claim and "allowed" alone would have hidden which list moved. A
   messages or notifications read refuses that fallback unless the caller's
   account owns the handle (`requireAccountOwner` in
   `lib/profileOwnership.ts`), so an unowned or deleted account's handle is
   nobody's inbox.
3. **`conversations` and `messages` are no longer deny-all.** Migration 0019
   created them RLS-on with no policy and says so in its own comment; 0066 then
   granted SELECT to `authenticated` behind two participant policies. The cell
   asserts the live rule: a participant reads their own thread, an outsider
   reads nothing, and SELECT is the whole grant, so the route stays the only way
   a message is written. The 0019 comment is now the older half of the story.
4. **An owner policy filters a statement, it does not error it.** A stranger's
   `update` on somebody's saves succeeded against zero rows. A table cell must
   therefore assert that nothing MOVED rather than that the statement failed.
   Since `0172` no browser role holds a write grant on `saved_pubs`, so the
   same `update` is refused at the grant, for the owner too, and the cell
   asserts the refusal as well as that nothing moved.

## The private profile card (migration 0154)

The account-privacy wave adds one visible account choice, so the matrix grew
four cells rather than a second table. Three things about them.

**The limited card is deliberately not a 404.** A private account answers its
handle, its display name, its face and its founding mark to everybody, and
withholds the bio, the city, the favourite drink, the interests, the workplace,
the cover rotation and the linked socials. That is the IG shape and it is the
useful one: a friend at the table has to know whose profile they reached before
they can add them, and the handle, name and face are already published for every
claimed account through the follow lists and the people directory. So the cell
asserts "recognisable and nothing withheld" rather than indistinguishability,
and a private account is knowable as a private account on purpose.

**A price is not covered, and the setting says so.** A Pint Drop is evidence
about a pub and stays public under the standing rule that we keep the prices, so
the choice governs the owner-authored profile card and nothing in a price lane.
`ACCOUNT_VISIBILITY_COPY.pricesStay` prints that beside the control.

**What these cells do NOT measure is the Social block, and that is named rather
than left to be found.** Carol is a mutual follower Alice has blocked, so by the
follow graph she is a mate and the projection seam answers her the full card. The
block lives in the Social product-account graph keyed on profile ids
(`social_blocks`, `lib/socialInteractionStore.ts`), a different identity space
from the follow-handle graph the seam reads, and it does not hide a PUBLIC
profile card from a blocked account either, so this wave neither opens that door
nor closes it. Folding the block into the seam is its own slice with its own
cells; asserting Carol's current answer here would write the gap down as intent.

## The URL allow-list

`__tests__/harvestUrlAllowList.test.ts` owns the other half of F07, the half
that is not about accounts: a URL this repository decides to FETCH is
caller-influenced input reaching a server-side request. Menu URLs come from
`harvest_venue_overlays.menu_url`, a pub's OSM `website` tag, or a link on a
page a crawl already read, and the same predicate gates every URL-taking
Context.dev call, where a passing URL also spends credit.

Three gaps were measured and closed in `isHarvestableOperatorUrl`:

1. **A subdomain of a refused host was harvestable.** `tobycarvery.co.uk` was
   refused and `menu.tobycarvery.co.uk` was not, so every refused estate had a
   way back in that the table still claimed to hold shut. A refusal is about an
   operator, so it now matches on a label boundary. A look-alike domain that
   merely contains a refused name is a different operator and is unaffected.
2. **Our own network was harvestable.** `localhost`, `127.0.0.1`, the private
   ranges and `169.254.169.254` all passed, which is a server-side request to
   our own infrastructure in the name of a pub.
3. **Credentials in a URL passed through**, and they are sent to whatever the
   URL names.

And one gap that a single-URL check cannot see: **a redirect chain was never
re-asked**. Both price crawl lanes fetch with `redirect: "follow"`, so the HOST
picks the last hop; both computed a `finalUrl` and handed it to nothing, so a
permitted site that 30x-ed to a refused one was read in full and the row was
then stamped with the asked-for URL, naming a page that never stated the price.
`harvestRedirectLanding` is the one owner of that rule and both lanes read it.

## Password paths, for the leaked-password setting

F07's other half is a Supabase dashboard toggle the captain owns
(https://supabase.com/docs/guides/auth/password-security). Three password paths
exist in the product and there is no fourth:

| Path | Where | What sets the password |
| --- | --- | --- |
| create | `components/auth/SetAccountPassword.tsx`, mounted in `PubmaxxAccountHub` | `supabase.auth.updateUser({ password })` from a signed-in browser |
| sign in | `POST /api/auth/handle-password` | GoTrue's password grant; sets nothing |
| change | `POST /api/auth/change-password/verify`, then the browser's own `updateUser` | GoTrue's password grant proves the old one; `updateUser` sets the new one |

There is **no password reset path and no password signup**: sign-up is the
email link (`lib/passwordlessAuth.ts`), and nothing in the tree calls
`resetPasswordForEmail` or `signUp` with a password. So every password this
product ever stores is written by `auth.updateUser`, which is exactly where
Supabase's HIBP check runs. Turning leaked-password protection on therefore
covers both writing paths and costs the sign-in path nothing: an existing
password is not re-checked at sign-in, so nobody is locked out by the change.

## Live check, isolated project

Read-only probe on the isolated `pubmax-pentest` project (2026-09-05), with the
anon key and the two seeded accounts' own sessions: the private Moment object
answered `NoSuchKey` on the public, authenticated and plain object paths and an
empty list on the bucket for anonymous, owner and stranger alike, and no client
could mint a signed URL for it. `night_moments` answered the owner's rows alone.
