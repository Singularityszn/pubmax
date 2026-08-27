# Pub Pal Landing Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pub Pal the landing-page front door with companion choice, five grounded guest prompts, progressive browser talk mode, and account conversion.

**Architecture:** Add a small pure guest-trial domain module, then compose it into the existing landing and `/pal/chat` clients. Keep `/api/ask` and authenticated ElevenLabs voice unchanged. Store only bounded trial metadata and the existing anonymous Pal draft.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, native CSS, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-08-27-pub-pal-landing-trial.md`

## Global Constraints

- Base work on current `origin/main` in `/Users/karanmanoharan/Documents/pubmax-pub-pal-landing`.
- Do not modify the dirty primary checkout.
- Do not issue anonymous ElevenLabs grants.
- Do not persist query text, answers, audio, or transcripts in guest-trial storage.
- Keep the fifth answer visible and gate the sixth ask.
- Use tests first for every production behaviour.
- Do not deploy before the shared London v0 release gate.

---

### Task 1: Guest trial domain and analytics vocabulary

**Files:**
- Create: `lib/palGuestTrial.ts`
- Test: `__tests__/palGuestTrial.test.ts`
- Modify: `lib/analyticsEvents.ts`
- Modify: `__tests__/analyticsEvents.test.ts`

**Interfaces:**
- Produces: `PAL_GUEST_PROMPT_LIMIT`, `PalGuestInputMode`, `PalGuestTrialState`, `readPalGuestTrial`, `writePalGuestChoice`, `recordPalGuestAnswer`, `palGuestChatHref`, `palGuestSignupHref`.
- Storage record contains only `version`, `answeredPrompts`, `species`, and `mode`.

- [ ] **Step 1: Write failing pure-domain tests**

```ts
expect(readPalGuestTrial(storage)).toEqual({
  answeredPrompts: 0,
  species: "robin",
  mode: "text",
});
expect(recordPalGuestAnswer(storage).answeredPrompts).toBe(1);
expect(recordPalGuestAnswer(storage, 9).answeredPrompts).toBe(5);
expect(palGuestChatHref("fox", "talk")).toBe("/pal/chat?mode=talk&pal=fox");
```

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `npm test -- __tests__/palGuestTrial.test.ts __tests__/analyticsEvents.test.ts`

Expected: FAIL because guest-trial exports and Pal CTA targets do not exist.

- [ ] **Step 3: Implement the bounded parser and analytics enum**

```ts
export const PAL_GUEST_PROMPT_LIMIT = 5;
export type PalGuestInputMode = "talk" | "text";
export type PalGuestTrialState = Readonly<{
  answeredPrompts: number;
  species: PubPalSpecies;
  mode: PalGuestInputMode;
}>;
```

- [ ] **Step 4: Run focused tests and verify pass**

Run: `npm test -- __tests__/palGuestTrial.test.ts __tests__/analyticsEvents.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/palGuestTrial.ts lib/analyticsEvents.ts __tests__/palGuestTrial.test.ts __tests__/analyticsEvents.test.ts
git commit -m "feat(pal): define five-prompt guest trial"
```

### Task 2: Remove route-first meeting gate

**Files:**
- Modify: `components/pal/PalExperience.tsx`
- Modify: `__tests__/pubPalExperience.test.ts`
- Modify: `e2e/mobile-pal-layout.spec.ts`

**Interfaces:**
- Consumes: existing anonymous onboarding draft.
- Produces: fresh `/pal` meeting and restored-draft onboarding without `PAL_ROUTE_ACTIVATION_KEY`.

- [ ] **Step 1: Add fresh-storage meeting and restored-draft tests**

```ts
it("opens the Pub Pal meeting without route activation", () => {
  expect(buttonContaining("Meet your Pub Pal")).toBeTruthy();
  expect(container.textContent).not.toContain("Make one useful route first");
});
```

- [ ] **Step 2: Run test and verify old activation screen failure**

Run: `npm test -- __tests__/pubPalExperience.test.ts`

Expected: FAIL because fresh storage renders `First, describe your night.`

- [ ] **Step 3: Remove activation state, imports, listeners, and branch**

Set restored draft mode with:

```ts
setMode(restored ? "onboarding" : "meeting");
```

- [ ] **Step 4: Remove E2E activation seeding and run focused tests**

Run: `npm test -- __tests__/pubPalExperience.test.ts __tests__/pubPal.test.ts`

- [ ] **Step 5: Commit**

```bash
git add components/pal/PalExperience.tsx __tests__/pubPalExperience.test.ts e2e/mobile-pal-layout.spec.ts
git commit -m "feat(pal): open first meeting to fresh visitors"
```

### Task 3: Pal-first landing hero

**Files:**
- Create: `components/landing/LandingPalEntry.tsx`
- Modify: `components/landing/LandingPage.tsx`
- Modify: `components/landing/landing.css`
- Modify: `__tests__/landingFindMyPintHierarchy.test.ts`
- Create: `__tests__/landingPalEntry.test.ts`
- Modify: `e2e/mobile-landing-entry.spec.ts`

**Interfaces:**
- Consumes: `PAL_ONBOARDING_SPECIES`, `PalPortrait`, `writePalGuestChoice`, and `palGuestChatHref`.
- Produces: `LandingPalEntry` with companion choice plus Talk and Text links.

- [ ] **Step 1: Write failing rendered-markup and interaction tests**

```ts
expect(markup).toContain("Choose your Pub Pal");
expect(markup).toContain("Talk to Circuit Robin");
expect(markup).toContain("Text Circuit Robin");
expect(markup).toContain('aria-pressed="true"');
```

Update landing hierarchy expectation so Pub Pal is primary and Map, Plan, Near
remain visible secondary routes.

- [ ] **Step 2: Run landing tests and verify failures**

Run: `npm test -- __tests__/landingPalEntry.test.ts __tests__/landingFindMyPintHierarchy.test.ts __tests__/landingHeroPriceCopy.test.ts`

- [ ] **Step 3: Implement one-preview companion picker and two modality actions**

On action, call `writePalGuestChoice`, write the existing anonymous onboarding
draft with selected species, track the closed CTA target, then navigate to the
guest chat href.

- [ ] **Step 4: Recompose hero using existing tokens and responsive CSS**

Use one companion preview, a horizontal name chooser, Talk and Text actions,
and lower-weight Plan, Map, and Near links. Keep dark/light tokens and reduced
motion behaviour.

- [ ] **Step 5: Run focused tests and commit**

```bash
npm test -- __tests__/landingPalEntry.test.ts __tests__/landingFindMyPintHierarchy.test.ts __tests__/landingHeroPriceCopy.test.ts
git add components/landing/LandingPalEntry.tsx components/landing/LandingPage.tsx components/landing/landing.css __tests__/landingPalEntry.test.ts __tests__/landingFindMyPintHierarchy.test.ts e2e/mobile-landing-entry.spec.ts
git commit -m "feat(landing): make Pub Pal the front door"
```

### Task 4: Five-answer guest chat gate

**Files:**
- Create: `components/pal/PalGuestAccountGate.tsx`
- Modify: `components/pal/PalChat.tsx`
- Modify: `components/pal/palChat.css`
- Create: `__tests__/palGuestAccountGate.test.ts`
- Modify: `__tests__/palChatClient.test.ts`

**Interfaces:**
- Consumes: guest-trial state and current auth user.
- Produces: fifth-answer completion and a composer replacement that cannot call `ask` again.

- [ ] **Step 1: Write failing gate and count tests**

```ts
expect(renderGate({ answeredPrompts: 5 })).toContain("Create your account");
expect(renderGate({ answeredPrompts: 5 })).toContain("/login?mode=signup");
```

Add a chat-session result test proving only non-error answers call the supplied
`onAnswered` callback.

- [ ] **Step 2: Run tests and verify missing behaviour**

Run: `npm test -- __tests__/palGuestAccountGate.test.ts __tests__/palChatClient.test.ts`

- [ ] **Step 3: Add callback seam to `createPalChatSession`**

```ts
type SessionOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onAnswered?: () => void;
};
```

Call it after `answered` or `empty`, never after `error` or superseded result.

- [ ] **Step 4: Integrate guest state into `PalChat`**

Read selected species/mode on mount, show selected Pal, disable `ask` when the
guest count is five, and replace composer only for signed-out users.

- [ ] **Step 5: Run focused tests and commit**

```bash
npm test -- __tests__/palGuestAccountGate.test.ts __tests__/palChatClient.test.ts __tests__/palChat.test.ts
git add components/pal/PalGuestAccountGate.tsx components/pal/PalChat.tsx components/pal/palChat.css lib/palChatClient.ts __tests__/palGuestAccountGate.test.ts __tests__/palChatClient.test.ts
git commit -m "feat(pal): gate guest chat after five answers"
```

### Task 5: Progressive browser talk mode

**Files:**
- Create: `lib/palBrowserSpeech.ts`
- Create: `components/pal/PalTalkControl.tsx`
- Modify: `components/pal/PalChat.tsx`
- Modify: `components/pal/palChat.css`
- Create: `__tests__/palBrowserSpeech.test.ts`
- Create: `__tests__/palTalkControl.test.ts`

**Interfaces:**
- Produces: `browserSpeechAvailability`, `createOneShotRecognition`, and `speakPalAnswer`.
- `PalTalkControl` returns one final transcript to the existing composer.

- [ ] **Step 1: Write failing browser capability tests**

```ts
expect(browserSpeechAvailability({})).toBe("unavailable");
expect(browserSpeechAvailability({ webkitSpeechRecognition: FakeRecognition })).toBe("available");
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run: `npm test -- __tests__/palBrowserSpeech.test.ts __tests__/palTalkControl.test.ts`

- [ ] **Step 3: Implement one-shot recognition and read-aloud helpers**

Configure `continuous = false`, `interimResults = false`, and `lang = "en-GB"`.
Never start from mount or an effect. Start only from the control handler.

- [ ] **Step 4: Integrate talk mode with text fallback**

Talk fills the visible input. User still presses Ask. Successful answer messages
are read aloud when speech synthesis exists. Unavailable and denied states keep
the text field usable.

- [ ] **Step 5: Run focused tests and commit**

```bash
npm test -- __tests__/palBrowserSpeech.test.ts __tests__/palTalkControl.test.ts __tests__/palChat.test.ts
git add lib/palBrowserSpeech.ts components/pal/PalTalkControl.tsx components/pal/PalChat.tsx components/pal/palChat.css __tests__/palBrowserSpeech.test.ts __tests__/palTalkControl.test.ts
git commit -m "feat(pal): add user-initiated browser talk mode"
```

### Task 6: Privacy notice and browser journey proof

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `__tests__/legalPages.test.ts`
- Create: `e2e/pub-pal-landing-trial.spec.ts`
- Create: `docs/proof/pub-pal-landing-trial/README.md`

**Interfaces:**
- Produces: exact public disclosure and mobile/desktop proof paths.

- [ ] **Step 1: Write failing legal and E2E acceptance assertions**

Legal test must require local five-prompt counter, no stored question/answer,
and browser-handled dictation copy.

E2E must mock `/api/ask`, choose Fox, send five asks, observe the fifth answer,
then prove no sixth request is made and the create-account link returns to `/pal`.

- [ ] **Step 2: Run legal test and verify failure**

Run: `npm test -- __tests__/legalPages.test.ts`

- [ ] **Step 3: Update privacy notice and run focused unit suite**

Run: `npm test -- __tests__/legalPages.test.ts __tests__/pubPalExperience.test.ts __tests__/palGuestTrial.test.ts __tests__/palChatClient.test.ts __tests__/landingPalEntry.test.ts`

- [ ] **Step 4: Check host resources, then run one-worker browser proof**

```bash
df -h /Users/karanmanoharan/Documents
vm_stat | head
npx playwright test e2e/pub-pal-landing-trial.spec.ts e2e/mobile-landing-entry.spec.ts e2e/mobile-pal-layout.spec.ts --workers=1
```

- [ ] **Step 5: Run targeted quality gates**

```bash
npm run lint
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit, push, and confirm remote branch**

```bash
git add app/privacy/page.tsx __tests__/legalPages.test.ts e2e/pub-pal-landing-trial.spec.ts docs/proof/pub-pal-landing-trial/README.md
git commit -m "docs(pal): disclose guest trial and talk mode"
git push -u origin codex/pub-pal-landing
git ls-remote --heads origin codex/pub-pal-landing
```

