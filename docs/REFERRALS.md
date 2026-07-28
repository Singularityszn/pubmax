# Referral integrity

Referral system records facts now and grants nothing. This split matters because
an append-only, permanent benefit needs stronger proof than current account and
contribution paths can provide.

## Boundaries

`lib/referralStore.ts` owns private invite journeys, immutable account edges,
qualification events, and reward history. `lib/referrals.ts` owns milestone
policy and closed grant gate. Public profiles and contribution leaderboards
must not import either module.

Browser attribution is first-touch, consent-gated, and lasts for one bounded
journey. Following a link redirects through a fragment that the landing client
removes immediately. Only an existing Anonymous usage analytics Allow choice
lets that client start the private journey and receive its HttpOnly cookie. It
genuinely fails when consent is absent, cookies are blocked or cleared, signup
happens on another browser or device, the journey expires, the link is invalid,
or account creation predates the click. These are absence of proof, so they
never fall back to a guessed attribution.

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
- delayed attribution must write the canonical invitee identity while keeping
  the verified Auth account creation time as evidence that signup followed the
  browser journey
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
