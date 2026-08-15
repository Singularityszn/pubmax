# Mobile Invite RSVP Map Handoff

Status: Approved for implementation

## Outcome

A handle-free guest who successfully records Going or Maybe on a public Plan
invite gets one clear next action: `Open these stops on the map`. The action
opens the ordered Crawl Route with no account gate.

## Design contract

| Field | Decision |
| --- | --- |
| Screen job | Confirm guest intent, then return that guest to PUBMAXX Map truth for the same Crawl Route. |
| Primary user and action | Signed-out invite guest records Going or Maybe, then opens the ordered stops on the Map. |
| Content hierarchy | Plan identity and stops first. RSVP form second. Server-confirmed completion and Map action third. Reactions remain last. |
| Navigation and controls | One native link after success. No automatic redirect. Browser Back returns to the invite. |
| Visual language | Reuse invite mat, brass, ink, line, radius, focus, and press tokens. Success reads as a compact continuation inside RSVP flow, not a new card or modal. |
| Required states | Initial and first submission: no Map handoff. Confirmed success: completion status plus Map link. Failed or malformed first response: inline error and no handoff. Zero valid Venue IDs: no Map link. |
| Responsive behavior | At 320px, 390px, and 430px, action is full-width, at least 44px high, does not overflow, and remains after the RSVP form in focus order. Desktop stays within the existing 560px mat. |
| Evidence used | [Revolut reimbursement confirmation](https://uizze.com/screens/699b436a002cf4cffead): completion state leads to one next action. [LinkedIn verification entry](https://uizze.com/screens/699c70f10006b7e2a68d): one linear continuation after a high-intent form. [Duolingo learning path selection](https://uizze.com/screens/4102a7711ec7dbe9a56e03bc6385e3af): one dominant full-width continuation on phone. Repository invite mat and existing Map URL builder remain authoritative. |
| Forbidden defaults | No generic toast, confetti, modal, floating CTA, duplicate pre-RSVP Map link, automatic navigation, account prompt, invented route, or new analytics event. |
| Acceptance criteria | Every condition in the next section passes in a production browser at 390x844 and in affected regression tests. |

Reference screens provide hierarchy evidence only. Do not copy their branding,
text, imagery, or exact layout.

## Product rules

1. `PlanInviteRsvp` owns whether this browser completed a successful RSVP.
2. Success becomes true only after a successful POST returns a valid RSVP
   summary. An HTTP error, network error, or success envelope without a summary
   must not reveal the handoff.
3. Existing server-rendered RSVP rows do not reveal the handoff. It follows a
   current-session action, not mere page history.
4. Remove the static pre-RSVP `See these pubs on the map` link from the invite
   card. One next action must own this transition.
5. Reuse `InviteMapLink`, `buildCrawlMapHref`, `venueMapUrl`, and
   `invite_map_opened`.
6. Two or more valid Venue IDs open
   `/map?mode=build&pubs=<ordered ids>`. One valid Venue ID opens its canonical
   selected-Venue Map URL. No valid IDs render no link.
7. The success status is announced without moving focus. Link remains a native
   anchor with visible focus and a 44px target.
8. Going and Maybe share the same next action. An RSVP update may keep a
   handoff already earned in the current session.

## Acceptance matrix

| Gate | Verification | Pass condition |
| --- | --- | --- |
| Initial honesty | 390px Playwright | No `Open these stops on the map` link before RSVP. |
| Confirmed success | Real public invite POST | Link appears only after guest row and count update from valid response. |
| Failure posture | Intercepted 503 POST | Inline error appears; Map handoff stays absent. |
| Ordered route | Link href and navigation | Multi-stop link preserves Venue ID order in `mode=build&pubs=`. |
| Mobile craft | Bounding boxes and screenshot | 44px target, no horizontal overflow, one clear primary continuation. |
| Accessibility | Keyboard and semantics | Completion uses status semantics; link is next in focus order and has visible focus. |
| Analytics | Existing event contract | Click emits only `invite_map_opened`; no registry change. |
| Regression safety | Focused tests, typecheck, lint, build | Existing invite RSVP, host removal, reactions, single-stop URL, and Map hydration remain green. |
