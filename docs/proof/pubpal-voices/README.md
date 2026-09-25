# Pub Pal per-species voice proof

## Automated (no ElevenLabs)

- `npm run test -- __tests__/palElevenLabsVoice.test.ts`
- `npm run test -- __tests__/pubPalVoiceTokenRoute.test.ts`
- `npx playwright test e2e/pubpal-concierge-phone.spec.ts` (text path, keyless)

## Live voice (needs credentials)

1. Set `ELEVENLABS_API_KEY`, agent id, shared secret, and per-species voice ids.
2. `npm run pubpal:design-voices` to create missing species voices.
3. Production build: `NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npm run start`
4. Sign in, open `/pal` and start voice. In the browser network tab, confirm a
   WebSocket to `elevenlabs.io` opens and carries transcript and audio frames.
   `/api/pub-pal/llm` never shows there: ElevenLabs calls it server to server.
   Confirm it in the deployment's request logs (Vercel: Logs, filtered to
   `/api/pub-pal/llm`) or in the conversation's history in the ElevenLabs
   dashboard.

### Headless browser proof: people can type and talk to it

`e2e/pubpal-voice-live.spec.ts` drives the real `/pal` page in headless
Chromium against a live deployment. The fake microphone plays a WAV into a real
ElevenLabs voice session. The spec reads the session's own WebSocket frames and
passes only when the spoken line comes back as a `user_transcript` and the Pal
then answers with an `agent_response` and non-empty `audio`. It also types a
question into `/pal/chat` and waits for the Pal's reply, and checks the voice
token and `/api/ask` over HTTP.

| Variable | What it is |
|---|---|
| `PUB_PAL_PROOF_BASE_URL` | The server under test. The spec skips without it |
| `PUB_PAL_PROOF_BEARER` | A Supabase access token for an account that has a Pal |
| `PUB_PAL_PROOF_STORAGE_STATE` | A Playwright storage state for the same account, signed in (`npx playwright codegen --save-storage=pal-proof.json <base-url>/login`) |
| `PUB_PAL_PROOF_WAV` | A short spoken question as a WAV file, e.g. "Where is a cheap pint near Camden?" |

```bash
PW_SKIP_WEBSERVER=1 npx playwright test e2e/pubpal-voice-live.spec.ts --project=chromium
```

With the base URL set, a missing bearer, storage state or WAV fails the run
rather than skipping it.

Evidence for the PR lands in the ignored `artifacts/pubpal-voice-proof/`:
`voice-session.json` (every transcript, agent response and audio frame with its
arrival time), `voice-session.png` and `typed-chat.png`. Attach all three to the
PR.

### What is committed, and what must run before merge

The HTTP proof (voice token, LLM bridge, text ask) and the Playwright concierge
proof below are committed. `e2e/pubpal-voice-live.spec.ts` is the captain's
talk proof: run it green before merge whenever the proof keys are available,
with exactly:

```bash
PUB_PAL_PROOF_BASE_URL=https://your-deployment \
PUB_PAL_PROOF_BEARER=<access token> \
PUB_PAL_PROOF_STORAGE_STATE=pal-proof.json \
PUB_PAL_PROOF_WAV=question.wav \
PW_SKIP_WEBSERVER=1 npx playwright test e2e/pubpal-voice-live.spec.ts --project=chromium
```

`docs/proof/pubpal-voices/local-proof-summary.json` carries a `voiceSession`
block. It reads `"status": "skipped"` until a green run replaces it with
`"status": "passed"` plus `connected`, `transcriptPresent`,
`agentResponsePresent`, `audioReplyBytes` and their timings. Commit that change
with the PR as the record that people can talk to the Pal.

Local proof (Sep 2026): with the production server on port 3102 and `.env.local` configured,
`docs/proof/pubpal-voices/local-proof-summary.json` records voice GET, LLM bridge,
and text ask statuses. Headless UI: `PUB_PAL_VOICE_E2E_CONFIGURED=1 PW_SKIP_WEBSERVER=1 PW_PORT=3102 npx playwright test e2e/pubpal-concierge-phone.spec.ts -g "text ask answers|voice explains"`.

`npm run pubpal:design-voices` writes `elevenlabs-voice-ids.env` and preview MP3s to the ignored `artifacts/pubpal-voices/` (they contain account-specific ids).
