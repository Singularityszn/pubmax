# Pub Pal setup: text now, voice when you switch it on

Pub Pal typed chat answers keylessly via `/api/pub-pal/chat` (the same grounded
`runAsk` tools as map Ask, no OpenRouter). Voice and the hosted-LLM typed path
share one ElevenLabs agent when the four values below are set and the agent
script has run. Map Ask still answers keylessly via `/api/ask`.

Nothing here changes what the Pal may SAY. Text and voice run the same
source-backed tool registry (ADR 0014) and the same propose-then-confirm rule
(ADR 0006).

---

## What works with no keys

| Surface | Keyless | Notes |
|---|---|---|
| `/pal/chat` text ask | Yes | `/api/pub-pal/chat` via deterministic `runAsk` when ElevenLabs is off; same agent as voice in text-only mode when it is on |
| Map Ask | Yes | Same `/api/ask` path |
| Concierge tools (prices, tonight, drinks, desk, crowd) | Yes | Every one of them reads a lane we already hold |
| Model tool selection | Keyless regex | With ElevenLabs, the hosted LLM on the agent picks webhook tools; neither path calls OpenRouter |
| Reader wording | Yes | House output comes from returned rows and hints; the model does not write the answer |
| Voice | No | Needs the four ElevenLabs values below |

With voice off, `/pal` says so in the Pal's own words and offers the writing
door. It never shows a Start button that would fail on the tap.

---

## The four values

Put these on the deployment (Vercel: Project → Settings → Environment
Variables → Production, Preview). All four are server-only.

| Key | What it is |
|---|---|
| `ELEVENLABS_API_KEY` | Account key. Never reaches the browser: `/api/pub-pal/voice-token` mints a short-lived signed session URL instead |
| `ELEVENLABS_PUB_PAL_AGENT_ID` | The agent the script below creates |
| `ELEVENLABS_LLM_SHARED_SECRET` | The secret ElevenLabs presents to `/api/pub-pal/tools/{name}`. Generate with `openssl rand -hex 32` |
| `ELEVENLABS_VOICE_ROBIN` … `_CORGI` | One voice id per species (`lib/palElevenLabsVoice.ts`). Create with `npm run pubpal:design-voices` |
| `ELEVENLABS_VOICE_EMBER` / `_VELVET` / `_SIGNAL` | The onboarding voice picks. When the slot for a Pal's pick is set it always wins; the species voice is used only when that slot is empty |

`.env.example` carries the same names with empty values.

---

## Designing species voices

```bash
# Preview descriptions only (no API key).
npm run pubpal:design-voices -- --dry-run

# Design, save to the ElevenLabs library, print env lines for Vercel.
npm run pubpal:design-voices
```

Generated preview audio and the voice id env lines land in `artifacts/pubpal-voices/`, which git ignores. Each id is appended to `artifacts/pubpal-voices/elevenlabs-voice-ids.env` as soon as its voice is saved, and a species whose `ELEVENLABS_VOICE_<SPECIES>` is already set, in the environment or in that file, is skipped, so a re-run after a failure only designs what is still missing.

---

## Creating the agent

```bash
# Local dry run: prints what would be written, holds the shared secret back,
# and calls nothing.
npm run pubpal:agent -- --dry-run --base-url https://pubmaxxing.com

# Real run: creates the agent, or updates the one already there.
npm run pubpal:agent -- --base-url https://pubmaxxing.com
```

The script reads `.env.local` and `.env`, so a local run needs no exported
shell variables. A dry run still needs `ELEVENLABS_LLM_SHARED_SECRET`, which the
script checks up front, but it never prints the secret or its locator; it does
not need `ELEVENLABS_API_KEY`, because it calls nothing. `--base-url` also
reads `PUBMAX_BASE_URL`, and it must be https (or `http://localhost` for a
tunnel test). It is idempotent: with `ELEVENLABS_PUB_PAL_AGENT_ID` set it
patches that agent, and without one it looks for an agent named
`PUBMAXX Pub Pal` before creating a new one. Re-running never leaves two.

It reads `scripts/pubpal/pub-pal-agent-config.json` (model, tool allowlist)
and PATCHes the agent plus workspace webhook tools. Each tool calls
`<base-url>/api/pub-pal/tools/{name}` with `ELEVENLABS_LLM_SHARED_SECRET`
(stored in the workspace vault as `PUBMAXX_PUB_PAL_LLM_SECRET`), waits up to
28 seconds for a response (`response_timeout_secs` in the script; the route
allows 30 seconds via `maxDuration`). Deploying the app alone does not change
the system prompt, the override grants, a tool schema, or the timeout on an
agent that already exists. The captain re-runs
`npm run pubpal:agent -- --base-url https://pubmaxxing.com` after those
changes. Do not run that command from an agent session.
Typed chat uses the same agent in text-only mode via `/api/pub-pal/chat`. Live
proof after a real run: `node scripts/pubpal/prove-pal-text-tool.mjs --base-url https://pubmaxxing.com`.

1. **Hosted LLM** (`gemini-2.5-flash-lite` by default) on the ElevenLabs plan.
2. **Webhook tools** for the ADR 0014 allowlist (same handlers as `/api/ask`).
   Each tool sets `pre_tool_speech: "force"` and `execution_mode: "immediate"`,
   so the Pal says one short checking line while the tool runs instead of
   staying silent until it returns. The four confirm tools (`propose_plan`,
   `propose_map_action`, `report_occupancy`, `propose_memory`) set `interruption_mode:
   "disable_during_tool_and_turn"` so the proposal is heard whole. Typed chat
   answers on the first reply when the turn asks for no tool. Once a turn asks
   for a tool, typed chat drops the checking lines. It returns a reply only
   when that reply came after the last tool event and no tool is still
   running, on `agent_response_complete`. The script adds that event and the
   tool events to the agent's `conversation.client_events`, so the captain
   re-runs `npm run pubpal:agent` to turn them on. On an agent without that
   event, a tool turn ends at the 22-second server deadline, which falls
   before the browser's 25-second abort, and returns the reply held under the
   same rule, or a timeout.
   One more webhook, `recall_memories`, is Pal-only. It returns the memories the
   person confirmed or corrected (never `completed_plan` rows) for the account
   that opened the conversation, read from the server-side conversation binding
   and never from the request body. Typed chat puts the same lines ahead of the
   ask on the server, or one line saying nothing is confirmed, so it does not
   need the tool. A second Pal-only webhook, `propose_memory`, adds a memory card
   to a typed chat for the bound account, only when that Pal has memory
   proposals on. It refuses in a voice call, where no card can be shown. It
   saves nothing: the memory exists once the person taps
   Confirm, which posts to `POST /api/pub-pal/memories`. Typed chat also carries
   a rolling session summary turn capped at 300 UTF-8 bytes, label included.
   A byte-level BPE token always covers at least one byte, so the turn is at
   most 300 tokens for any input. It is built only from the person's own older
   asks and never used as a fact source.
3. **Voices** and per-session `voice_id` overrides (unchanged).
4. **House prompt**: call tools before any fact, never invent a price, propose
   then confirm, plain speech on get-home topics.

On a first create the script prints the agent id. Put it on the deployment as
`ELEVENLABS_PUB_PAL_AGENT_ID` and redeploy.

If the voice WebSocket closes immediately with code **1008** and reason
`Override for field 'voice_id' is not allowed by config.`, the deployed agent
was created before session voice overrides were enabled. Re-run
`npm run pubpal:agent -- --base-url https://pubmaxxing.com` with
`ELEVENLABS_PUB_PAL_AGENT_ID` set so
`platform_settings.overrides.conversation_config_override.tts.voice_id` is
`true` on that agent.

If the UI shows **Failed to load the rawAudioProcessor worklet module** (or the
session never reaches "Pal is listening" after metadata), the same-origin
AudioWorklet files were not copied. `npm run prepare:maplibre-worker` (the first
step of `npm run dev` and `npm run build`) writes them to `public/vendor/elevenlabs/`, and the voice session
passes those paths so `script-src` can stay `'self'` plus the nonce. Do not put
`blob:` or `data:` back into `script-src`.

---

## Checking it

```bash
# Read-only drift check. It GETs the live agent and tools, compares them with
# the config in this repo, prints each difference and exits 1 on any drift.
# It needs ELEVENLABS_API_KEY and --base-url, and never needs the shared secret.
npm run pubpal:agent -- --check --base-url https://pubmaxxing.com

# Answers available, maxSessionSeconds, retention and mutationPolicy.
# `available` turns true once `ELEVENLABS_API_KEY` and the agent id are set.
curl -s https://pubmaxxing.com/api/pub-pal/voice-token | jq .

# Should answer 401 without the shared secret, never 200.
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://pubmaxxing.com/api/pub-pal/tools/search_venues \
  -H 'content-type: application/json' \
  -d '{"parameters":{"query":"cheapest pint in Camden"}}'
```

Then open `/pal`, create a Pal, and press Start voice chat. The status line
reads "Pal is listening" once the socket is up.

On the first tap, the browser asks for microphone access before the server
issues a metered voice grant. A denied request keeps the writing door open and
can be retried. Repeated taps while voice starts use the same attempt.

`GET /api/pub-pal/voice-token` answers one boolean about this deployment's own
configuration and reads no account, which is the whole reason the Pal can
explain itself before the tap. `POST` still needs a signed-in caller and spends
a metered minute (`lib/palVoiceMetering.ts`).

---

## What does not need a key

Do not gate the concierge tools behind any of this. `cheapest_pint_near`,
`tonight_now`, `venue_drinks`, `find_desk` and `report_occupancy` all answer
keylessly from lanes we already hold. One of them is honest about holding
nothing yet, and one writes only on a confirm:

- **`find_desk`** answers only from cafe, co-working and library rows. The
  London pack carries none of those today, so it says "No seat data yet" rather
  than offering a pub as a desk.
- **`report_occupancy`** proposes a crowd report (empty / some seats / full)
  and writes nothing until the reader confirms. Confirm POSTs
  `/api/venues/[id]/occupancy`. `occupancyStoreState()` is the one switch
  that can roll that confirm back to unbuilt.

---

## Headless live voice proof

Captain proof is `e2e/pubpal-voice-live.spec.ts` against a server that loads
ElevenLabs and Supabase from `.env.local`. Seed the documented QA account per
`docs/testing/signed-in-review.md`, sign in, create a Pal, save Playwright
storage state, then run:

```bash
PW_SKIP_WEBSERVER=1 \
PUB_PAL_PROOF_BASE_URL=http://localhost:3102 \
PUB_PAL_PROOF_BEARER=<supabase access token> \
PUB_PAL_PROOF_STORAGE_STATE=/path/to/storage.json \
PUB_PAL_PROOF_WAV=/path/to/proof-utterance.wav \
PUB_PAL_PROOF_EXPECTED_UTTERANCE="What pub should we start at?" \
PUB_PAL_PROOF_SPECIES=fox,robin \
npx playwright test e2e/pubpal-voice-live.spec.ts --project=chromium
```

Evidence lands in `artifacts/pubpal-voice-proof/` (gitignored) for the PR
description. The spec patches the Pal to each species in `PUB_PAL_PROOF_SPECIES`
(default `fox,robin`) and requires `user_transcript`, `agent_response`, and
audio frames on the ElevenLabs WebSocket.

---

## Related

- `docs/adr/0006-pub-pal-user-owned-digital-companion.md` - what a Pal may do
- `docs/adr/0014-night-os-ask-agent.md` - the tool allowlist
- `docs/adr/0016-pub-pal-confirmed-memory-recall.md` - what the Pal reads from
  confirmed memories
- `docs/VOICE.md` - how every line above had to read
