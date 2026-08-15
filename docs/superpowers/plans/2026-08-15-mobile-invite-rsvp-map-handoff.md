# Mobile Invite RSVP Map Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development and execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one ordered Map continuation only after a public invite guest completes a server-confirmed RSVP.

**Architecture:** Keep RSVP completion state inside `PlanInviteRsvp`, because it owns the POST result. Pass the server-ordered Venue IDs from the invite page into that client island, move the existing `InviteMapLink` into the success branch, and reuse existing Crawl Route URL and analytics seams.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Playwright, Vitest.

**Spec:** `specs/mobile-invite-rsvp-map-handoff.md`

## Global Constraints

- Use PUBMAXX domain language: Venue, Crawl Route, Crawl Stop, Map.
- Use British spelling and no em dash.
- No account gate or automatic navigation.
- No new analytics event or URL builder.
- Use native anchor semantics, visible focus, and a 44px target.
- Preserve Going, Maybe, host removal, reaction, and RSVP update behavior.
- Test must fail against current production code before implementation.

---

### Task 1: Mobile RSVP completion and Map continuation

**Files:**

- Create: `e2e/mobile-invite-map-prompt.spec.ts`
- Modify: `components/plan/PlanInviteRsvp.tsx`
- Modify: `components/plan/InviteMapLink.tsx`
- Modify: `app/invite/[token]/page.tsx`
- Modify: `app/invite/[token]/invite.css`
- Modify: `e2e/plan-invite.spec.ts`

**Interfaces:**

- Consumes: `PlanInviteRsvp({ token, planId, initialRsvp, initialReactions, venueIds })`
- Consumes: `InviteMapLink({ venueIds })`
- Produces: visible `Open these stops on the map` native link after confirmed RSVP
- Produces: existing `invite_map_opened` event on link click

- [ ] **Step 1: Write failing public-browser tests**

Create a 390x844 Playwright test that creates a real three-stop Plan and opens
its public invite in an anonymous page. Before RSVP, assert no Map link. Submit
Going through the rendered form. After server-confirmed guest row appears,
assert:

```ts
const handoff = page.getByRole("link", { name: "Open these stops on the map" });
await expect(handoff).toBeVisible();
await expect(handoff).toHaveAttribute(
  "href",
  `/map?mode=build&pubs=${venueIds.join(",")}`,
);
```

Assert target height is at least 44px, document width equals 390px, keyboard
Tab reaches the link after the RSVP action, and click navigates to the ordered
Map URL. Add a second test that intercepts the RSVP POST with 503 and asserts
the inline error plus no handoff. Update the existing invite-loop test so it
expects the Map link after, not before, the RSVP.

- [ ] **Step 2: Run RED proof**

Run:

```bash
PW_SKIP_WEBSERVER=1 PW_PORT=3101 \
  npx playwright test e2e/mobile-invite-map-prompt.spec.ts \
  --project=chromium --workers=1 --retries=0
```

Expected: failure because the current invite renders a pre-RSVP link with the
old label and has no success-owned handoff.

- [ ] **Step 3: Implement minimal success-owned state**

Add `venueIds: string[]` to `PlanInviteRsvp`. Add a local boolean that starts
false and becomes true only inside the valid `data.summary` branch after
`setRsvp(data.summary)`. Do not set it for non-OK responses, thrown requests, or
missing summaries.

Render this after the form error lane and before reactions:

```tsx
{rsvpCommitted && venueIds.some(Boolean) ? (
  <div className="inviteRsvp__mapPrompt">
    <p className="inviteRsvp__status" role="status">RSVP saved.</p>
    <InviteMapLink venueIds={venueIds} />
  </div>
) : null}
```

Pass ordered `stops.map((stop) => stop.venueId)` from the server page. Remove
the server page's static `InviteMapLink`. Change the link copy to
`Open these stops on the map`.

- [ ] **Step 4: Apply product-specific mobile styling**

Use existing tokens only. Make the handoff one compact RSVP continuation, with
full-width native link, `min-height: 44px`, existing ink primary surface,
visible brass focus, and press feedback through existing press token. Do not add
a new card shadow, icon, illustration, modal, animation, or helper paragraph.

- [ ] **Step 5: Run GREEN proof and affected regressions**

Run the new focused browser file, `e2e/plan-invite.spec.ts`, focused invite
Vitest tests, typecheck, focused ESLint, and `git diff --check`. Any failure
blocks the next step.

- [ ] **Step 6: Capture and inspect production screenshots**

Build with a dedicated `NEXT_DIST_DIR` and 4GB Node heap. Capture 320px, 390px,
and 430px success states. Inspect visual hierarchy, target sizes, overflow,
focus ring, long Venue names, light mode, dark mode, and reduced motion.

- [ ] **Step 7: Independent review and commit**

Give a Sol 5.6 high-effort reviewer the spec, diff, RED/GREEN output, and
screenshots. Fix every actionable finding with a new failing test. Run full
`npm run verify`, restore Next tool churn, confirm clean worktree, then commit.
