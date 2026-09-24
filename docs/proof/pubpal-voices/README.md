# Pub Pal per-species voice proof

## Automated (no ElevenLabs)

- `npm run test -- __tests__/palElevenLabsVoice.test.ts`
- `npm run test -- __tests__/pubPalVoiceTokenRoute.test.ts`
- `npx playwright test e2e/pubpal-concierge-phone.spec.ts` (text path, keyless)

## Live voice (needs credentials)

1. Set `ELEVENLABS_API_KEY`, agent id, shared secret, and per-species voice ids.
2. `npm run pubpal:design-voices` to create missing species voices.
3. Production build: `NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npm run start`
4. Sign in, open `/pal`, start voice; confirm `/api/pub-pal/llm` in network tab.

Headless Chromium with fake mic:

```bash
npx playwright test e2e/pubpal-voice-live.spec.ts \
  --config=playwright.config.ts \
  --headed=false
```

Set `PUB_PAL_PROOF_WAV` to a short question WAV and `PUB_PAL_PROOF_BASE_URL` to the server.
