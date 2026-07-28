# Referral integrity

Referral system records facts now and grants nothing. This split matters because
an append-only, permanent benefit needs stronger proof than current account and
contribution paths can provide.

## Boundaries

`lib/referralStore.ts` owns private invite codes, immutable account edges,
qualification events, and reward history. `lib/referrals.ts` owns milestone
policy and closed grant gate. Public profiles and contribution leaderboards
must not import either module.

Following an invite redirects with its opaque code in a URL fragment. No
referral cookie or server-side attribution state is created while the person
browses. Existing auth-attempt coordination carries the fragment through a
deliberate sign-up. Only a successful callback for a newly created account can
submit the code and record an edge. Before auth starts, the server signs the
browser auth-attempt ID and issue time. Claim verifies that proof and requires
the verified Supabase Auth account creation time to follow it. A delayed return,
another browser or device, an invalid code, or an existing account is not
attributed. These are absence of same-journey proof, so they never fall back to
a guessed attribution. Proof issuance and attribution claims are fail-soft:
either may be skipped without blocking account sign-in.

An account edge alone is not a qualified referral. Qualification needs a first
accepted contribution carrying that invited account's verified auth ID. Current
contribution rows do not carry that proof, so no production route calls the
qualification seam.

## Grant gate

Milestone evaluation may append an earned record, but entitlement reads accept
only a later `feature_granted` event. No such event can be written while
`REFERRAL_GRANT_GATE` is closed.

Opening the gate requires both:

- accepted contribution writes derive a verified account ID on the server
- a reviewed person-level check can reject one person operating several OAuth
  accounts without pretending an account ID proves a human

Direct self-edges and two-account circles are rejected already. That is
necessary, but it is not the person-level proof needed for permanent benefits.

## Identity handoff

Current invite-code ownership, invite edges, private status reads, attribution
claims, and erasure all key on Supabase Auth user IDs. A canonical contributor
identity would change each boundary:

- invite creation and private status must translate the signed-in account to
  the canonical contributor before reading or writing referral records
- same-journey attribution must write the canonical invitee identity while
  keeping the signed attempt start and verified Auth account creation time as
  evidence of new signup
- accepted contribution writes must attach that same canonical identity on the
  server before they may call the qualification seam
- person-level anti-self-referral checks must run before qualification and
  before any grant event, because two Auth IDs do not prove two people
- account deletion must erase referral data through every Auth-account mapping
  attached to the canonical contributor

Existing referral rows need an explicit Auth-ID-to-contributor-ID migration when
that key lands. They must not be joined by handle, email, device token, or
caller-supplied account ID as a proxy.

## Privacy and erasure

Invite edges and both account IDs stay private. APIs return only the signed-in
account's own link and aggregate counts. Ordinary edge, qualification, and
ledger writes are append-only. Verified account erasure uses the dedicated
database erasure function so auditability does not override deletion rights.
Erasure also stores a one-way account-ID hash in a referral-only write block.
Every referral write checks that block, so a still-valid session cannot recreate
private referral data after deletion.
