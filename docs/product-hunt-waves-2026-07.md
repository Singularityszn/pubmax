# Product Hunt waves, July 2026

## Product thesis

Generic AI itinerary generation is table stakes. Wingman City Guide, Mindtrip,
Copilot2trip, Guide, 80days.me, and Luxury Escapes Trip Planner already turn
preferences into mapped itineraries. Moisam finds a midpoint from several start
points. Walkable makes a route trade-off explicit and users ask it to recalculate
while they are moving. Generating three plausible stops is no longer a product
position on its own.

PUBMAXX should win on what generic planners do not know: the crew's confirmed
progress, current pint evidence, route-relative rendezvous, what is actually on,
and whether everyone can still get home. The useful question is not only “where
should we go?” It is “where can I catch this specific night now, and what proof
supports that answer?”

## Wave 1: Join in Motion

Status: implemented in this branch.

The pure decision contract lives in `lib/crawlIntercept.ts`; the Plan-page
surface lives in `components/plan/JoinInMotion.tsx` and is mounted by
`app/plan/[id]/page.tsx`.

Join in Motion gives a late-arriving guest a useful answer from the existing Plan
link. They choose when they can leave, and PUBMAXX recommends the stop at which
to intercept the crawl. It is the smallest route-relative rendezvous product that
works without a new account, contact import, live-location broadcast, or parallel
planning flow.

The implemented contract is deliberately narrow:

- It appears only on an incomplete `/plan/[id]` page.
- The guest chooses Leaving now, 15, 30, 45, or 60 minutes.
- Route progress comes only from recorded `arrived` and `skipped` actions. A
  proposal, edit, or duplicate action cannot move the recommendation.
- The first uncompleted stop is current. ETA advances through the ordered route
  using a conservative, explicit dwell assumption and never advances beyond the
  final stop.
- The Plan is refreshed while the page is visible. A refresh failure preserves
  the last confirmed answer instead of inventing progress.
- The result offers walking directions and a short “Tell the crew” share or copy
  action. It does not mutate the Plan.
- The ETA choice is session-scoped. The guest's device location is neither
  requested nor stored.

This follows the best adjacent patterns without copying their product shape.
SoKal makes an off-app RSVP useful, Moisam makes one guest link sufficient, and
Walkable treats recalculation during a route as the real job. PUBMAXX adds the
missing pub-night evidence: actual crew actions determine the intercept.

### Success measures

Measure the funnel after the analytics-attribution branch lands. Wave 1 itself
does not add competing analytics code.

1. **Discovery:** active Plan opens that expose Join in Motion.
2. **Intent:** exposed guests who choose an ETA.
3. **Answerability:** ETA selections returning a stop versus the honest
   no-intercept state.
4. **Action:** answered sessions that open directions or use Tell the crew.
5. **Outcome:** actioned sessions followed by that guest joining or recording an
   arrival, using existing Plan identity and action records rather than location.
6. **Quality:** recommendation changes caused by new confirmed progress, refresh
   failures, final-stop clamps, and duplicate-action suppression.

Report counts and conversion rates with their denominators. Do not set a target
until production traffic establishes a baseline, and do not collect raw
coordinates to improve the chart.

### Privacy and accuracy guardrails

- No background location, location sharing, proximity inference, or crew map.
- No raw coordinates in URLs, analytics, logs, share text, or storage.
- A guest link must remain useful without account creation or contact import.
- Only canonical Plan actions can establish crew progress. Time passing alone
  never marks a stop complete.
- The dwell assumption is a routing heuristic, not a claim that the crew will
  remain at a pub for that duration. Keep it conservative, test-pinned, and easy
  to replace with measured behavior later.
- Directions should resolve the canonical venue or its coordinates. A name-only
  search is a fallback and must not be described as a verified destination.
- Empty, stale, or failed reads produce the last confirmed answer or an honest
  “ask the crew” state. They never produce a guessed pub.
- Share text names a target stop but never discloses who is present, where a
  person lives, or the guest's ETA unless the guest explicitly chooses to add it.
- Joining in motion must not overwrite the locked route, cast a vote, mark an
  arrival, or consume a collaboration entitlement.

## Later wave: Night Intent RSVP

Night Intent answers the question before a Plan exists: “who might be out?” A
host shares one lightweight link; guests choose In, Out, or Thinking and may add
a bounded intent such as Join me, Call me, FYI, or Text me. SoKal demonstrates
the value of three-state intent, The Week demonstrates action-shaped intent
tags, and Tofu Maps and Prit show why guest entry should remain link-first and
account-optional.

This is not Plan presence, push targeting, or a new social graph. It is a
time-bounded pre-plan signal that expires and can graduate into a Plan only when
the host chooses. Build it after auth and analytics ownership settle so the link
contract and guest-to-host measurement are not duplicated.

## Later wave: Ghost Routes

Ghost Routes let a friend suggest a complete route variant without editing the
host's canonical Plan. The host previews a translucent alternative, compares the
changed stops, and accepts or discards it as one decision. Prit's draft
suggestions avoid the social awkwardness of open co-editing; Mapus and MapMagic
show the appeal of visible collaborative map work.

This is not another generator and not simultaneous mutation of the locked route.
It should be an append-only proposal built on the existing collaboration journal
after PlanComposer, grounded generation, and the Plan mini-map lanes land. The
canonical Plan remains untouched until an authorized host accepts the ghost.

## Later wave: House Hunt

House Hunt is a crew mission to find its repeat pub. The group agrees place-fit
criteria, visits candidates, attaches evidence, and crowns a house venue. Cravit
provides the useful pattern: a shared mission, custom criteria, recorded visits,
and a group comparison that ends in one choice.

PUBMAXX must score the place, not alcohol consumption. Suitable criteria include
price confidence, journey fairness, accessibility, events, noise, seating, and
crew-authored visit proof. There are no pint-count streaks, drinking leaderboards,
or pay-to-rank inputs. This wave reuses reviewed Visit Reports and price proof; it
does not rebuild the venue-operator or contribution stores.

## Later wave: Proof-of-Pub discovery

Proof-of-Pub ranks recommendations by evidence that someone actually visited,
not by generic ratings or polished list copy. A discovery card can show the
friend, dated Visit Report, confirmed price, contextual note, and provenance that
earned its place. NomNak's Food Passport separates actual-visit history from
socially pressured recommendations. Tofu Maps favors small, contextual place
libraries. North uses friends-only catalogues, private ratings, and collaborative
lists instead of an undifferentiated public feed.

This is a read model over evidence PUBMAXX already collects. It must preserve the
existing review, visibility, provenance, withdrawal, and freshness rules. A place
with weak or stale proof ranks lower or stays absent; popularity cannot substitute
for proof.

## Deliberate non-overlap

These waves avoid work already owned elsewhere:

- auth callback recovery and passwordless identity;
- live-location precedence and remembered-area behavior;
- PlanComposer, progressive intake, and grounded Plan generation;
- the Plan route mini-map and walk-route hardening;
- web-push transport, push identity joins, and daily brief delivery;
- analytics attribution, consent delivery, and trusted signing; and
- restaurants and attractions ingestion through the provenance/slop-filter lane.

Wave 1 reads the existing Plan and its confirmed actions. Later waves are
sequenced after their relevant owners land. None requires a second auth system,
a second generator, a second push registry, or a competing ingestion pipeline.

The cross-cutting launch rule comes from the FriendMap and Gowalla failure mode:
do not require critical mass or contact import before the feature has value. One
guest link must produce a useful outcome for one real night.

## Wave 2 shipped

- Web Share Target registration for installed/mobile users.
- `/share` triages shared pub names, map links, and PUBMAXX links.
- Internal PUBMAXX links open directly; external shares become `/map?q=...&intent=share`.
- No auth, persistence, location collection, or ownership overlap with map sheet/planner lanes.
