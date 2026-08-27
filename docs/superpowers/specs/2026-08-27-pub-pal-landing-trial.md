# Pub Pal Landing Trial Specification

## Product decision

Pub Pal is a defining front-door feature. A signed-out visitor can choose a
companion and ask five grounded questions by text or user-initiated browser
dictation before account creation becomes the next action.

## Goals

- Make Pub Pal the main landing-page action without removing Map, Plan, or Near.
- Offer every reviewed launch companion from `PAL_ONBOARDING_SPECIES`.
- Let a signed-out visitor receive five complete grounded answers.
- Keep the fifth answer visible, then replace the composer with account creation.
- Preserve the chosen companion for the account-owned five-step Pal setup.
- Offer a talk mode without weakening the authenticated ElevenLabs grant.
- Keep raw audio, transcripts, and generated prose out of Pal Memory.

## Non-goals

- Do not issue anonymous ElevenLabs grants.
- Do not change the provider voice quota, retention, or proposal policy.
- Do not create a Pub Pal before authentication and adult attestation.
- Do not persist the guest transcript as Pal Memory or account data.
- Do not deploy before the shared London v0 release gate.

## Guest flow

1. Landing hero shows one large companion preview and all seven companion names.
2. Visitor selects a companion.
3. `Talk` opens `/pal/chat?mode=talk&pal=<species>`.
4. `Text` opens `/pal/chat?mode=text&pal=<species>`.
5. Landing saves only the selected companion and default anonymous Pal draft.
6. Text mode uses the existing grounded `/api/ask` path.
7. Talk mode uses one user-initiated browser speech-recognition action to fill
   the same text composer. Visitor reviews and sends the text. Successful Pub
   Pal answers are read aloud with browser speech synthesis when available.
8. Only answered or honest-empty responses consume one guest prompt. Network,
   timeout, and service errors do not consume a prompt.
9. After the fifth answer, input controls are replaced by account creation and
   sign-in links. The transcript stays visible for the current page lifetime.
10. Account creation returns to `/pal`. Existing anonymous draft migration
    carries the selected companion into account-owned setup.

## Signed-in flow

Signed-in users are not subject to the five-prompt guest conversion gate. The
existing server rate limits, provenance, confirmation, and safety rules remain.
Provider voice remains available only through the existing authenticated Voice
Session Grant after a Pal exists.

## Storage and privacy

- Local storage key: `pubmaxx.pub-pal-guest-trial.v1`.
- Stored fields: schema version, successful prompt count, selected companion,
  and last selected input mode.
- Count is clamped to `0..5` and survives reloads on the same browser.
- No query text, answer text, audio, transcript, coordinates, account identity,
  or handle is stored in this record.
- Browser dictation starts only after a button press and stops after one result.
- UI states that the browser turns speech into reviewable text.
- Privacy notice names the local counter and browser dictation behaviour.

## UI and accessibility

- Existing PUBMAXX CSS tokens, coral accent, typography, theme switch, and
  companion visuals remain authoritative.
- Landing stays a responsive asymmetric split and keeps initial actions usable
  at 320, 390, 430, 1280, and 1440 pixels.
- Companion choices use `aria-pressed` and visible focus.
- Talk control has explicit listening, unavailable, and error states.
- Talk mode always retains the text field as fallback.
- Account gate is an accessible region with one create-account action and one
  sign-in action.
- No new visible em dash is permitted.

## Analytics

- Extend `landing_cta_clicked.target` with `pal_talk` and `pal_text`.
- Reuse consent-gated `concierge_ask` for asks.
- Do not send companion choice, query text, transcript, account identity, or
  prompt count to analytics in this slice.

## Acceptance

- Fresh `/pal` shows the meeting screen without route activation storage.
- Landing visitor can choose each launch companion.
- Talk and Text preserve selected companion into `/pal/chat` and `/pal` draft.
- First five successful guest answers render normally.
- Sixth guest ask cannot call `/api/ask` and account gate is shown.
- Failed asks leave remaining prompt count unchanged.
- Signed-in chat has no five-prompt gate.
- Talk mode works when browser speech APIs exist and degrades to text otherwise.
- Privacy copy matches stored and transmitted data.
- Focused unit, component, E2E, lint, and type checks pass.

