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

Local proof (Sep 2026): with dev on port 3102 and `.env.local` configured,
`docs/proof/pubpal-voices/local-proof-summary.json` records voice GET, LLM bridge,
and text ask statuses. Headless UI: `PUB_PAL_VOICE_E2E_CONFIGURED=1 PW_SKIP_WEBSERVER=1 PW_PORT=3102 npx playwright test e2e/pubpal-concierge-phone.spec.ts -g "text ask answers|voice explains"`.

Do not commit `elevenlabs-voice-ids.env` or preview MP3s (they contain account-specific ids).
