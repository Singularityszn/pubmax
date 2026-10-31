# Pub Pal setup: text now, voice when you switch it on

Pub Pal typed chat answers keylessly via `/api/pub-pal/chat` (the same grounded
`runAsk` tools as map Ask, no OpenRouter). Voice and the hosted-LLM typed path
share one ElevenLabs agent when the four values below are set and the agent
script has run. [ADR 0014](adr/0014-night-os-ask-agent.md) owns the deterministic
menu and price routing that precedes provider selection.
Map Ask still answers keylessly via `/api/ask`.

## Typed chat on Claude

Typed chat can run on Claude instead of the ElevenLabs agent. Voice stays on
ElevenLabs.

1. Make an API key in the Claude Console. Set a monthly spend limit there.
2. Set `ANTHROPIC_API_KEY` on the deployment (server-only).
3. Optional: set `PUB_PAL_CLAUDE_MODEL`. The default is `claude-haiku-5-5`.

When the key is set, `/api/pub-pal/chat` sends each typed ask to Claude
(`lib/palClaudeChat.server.ts`). It needs a signed-in session and spends the
same `pub-pal-chat` ceiling. The safety fence, the answers from records, the
memories and the taste read run before Claude is asked, as they do for
ElevenLabs. Claude uses the same tools (`lib/pubPalToolCatalog.mjs`) and the
same prompt rules (`lib/palVoicePrompt.mjs`, without the spoken parts). Our
server runs each tool itself, so no webhook is involved. To go back to
ElevenLabs for typed chat, remove the key.

Nothing here changes what the Pal may SAY. Text and voice run the same
source-backed tool registry (ADR 0014) and the same propose-then-confirm rule
(ADR 0006).

---

## What works with no keys

| Surface | Keyless | Notes |
|---|---|---|
| `/pal/chat` text ask | Yes | `/api/pub-pal/chat`. Provider selection follows ADR 0014 |
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

## Changing only transcript deletion

The captain can use the deletion-only command after separately approving a live operation.
Privacy applies to the whole agent across every branch. ElevenLabs permits this update only on Main.
A private branch does not establish traffic isolation.

The release owner must provide an attestation file for the exact executing agent and Main branch.
The file must contain these fields with the approved identities and explicit `true` values:

```json
{
  "agent_id": "agent_APPROVED_TARGET",
  "branch_id": "APPROVED_MAIN_BRANCH",
  "target_is_main": true,
  "whole_agent_traffic_isolated": true,
  "executing_binding_verified": true,
  "remote_exclusive_writer_verified": true,
  "live_operation_approved": true
}
```

This file records owner attestations. The command cannot establish remote isolation or writer ownership itself.
Neither source approval nor synthetic tests authorise a provider operation.

```bash
npm run pubpal:agent -- --privacy-delete-only \
  --agent-id agent_APPROVED_TARGET \
  --branch-id APPROVED_MAIN_BRANCH \
  --privacy-attestation path/to/owner-attestation.json
```

This command uses the existing `ELEVENLABS_API_KEY` environment value.
It does not load local environment files, discover agents, or read or write workspace tools and secrets.
It rejects `--check` and `--dry-run` combinations before any request.
The existing provisioner retains its own check and dry-run behaviour.

The command requires matching agent, branch and Main identities in the scoped pre-read.
It validates the complete writable configuration against the pinned update-input models.
It preserves optional presence, nulls, false values, zeros, array order, settings and opaque credential references.
It publishes the explicit current procedure versions, including an established empty map.
Missing procedure membership or unpublished versions cause refusal before PATCH.

The closed contract is in `scripts/pubpal/privacy-delete-only.mjs`.
Its 435 normalised models derive from the public OpenAPI snapshot with SHA-256
`46ac8c4c216f924978560b0aafb81ef9fa642da6ef44a924f817d02d3bf71668`.
The acquisition contract has SHA-256
`3673443de6adc846ae7425e19f879af6b4f948c7adc2ff7132f74dd23ea958f2`.
The separately documented typed configuration roots constrain the endpoint's generic maps.
Schema defaults never create absent fields.
Unknown named fields, unsupported input variants and unpreservable values cause refusal.
The operation excludes response-only identity, metadata, platform safety and read-only hold-audio fields from PATCH.
It refuses inline shareable tokens, static SIP headers and inline request headers except Content-Type.
The pinned response contract cannot establish that these sensitive inline values are unmasked.
Prompt text does not undergo a redaction-word heuristic.

A successful mutation makes at most one scoped GET, one PATCH and one GET.
Only `platform_settings.privacy.delete_transcript_and_pii` changes to `true`.
The post-read must retain the same identities and every untargeted writable value.
An already enabled, validated target needs only the pre-read and makes no write.
HTTP failures, ambiguous failures and readback differences cause failure without retries or extra writes.
The command prints no provider payload, prompt, credential or error response.
The owner must reconcile a failed or ambiguous operation before another attempt.

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

Update and `--check` resolve each tool by the same identity rule. The script
first reads the existing agent and its attached tool IDs. It keeps the unique
attached webhook for each name when `--base-url` changes, including moves to
a tunnel and back to production. Update writes the requested endpoint to that
same tool ID. Check reports a different URL as drift without writing.
Same-name workspace duplicates cannot replace that attachment.

Without an attached match, the script reuses one compatible workspace webhook.
Its URL must exactly match `<base-url>/api/pub-pal/tools/{name}`.
If none exists, update creates a webhook and check reports it as missing.
Multiple attached matches or multiple compatible workspace matches cause a
refusal. An incompatible attached type, an unknown attached ID, or an incomplete
workspace tool list also causes a refusal. Update resolves all identities before
writing a secret, a tool, or the agent. Other tool settings remain part of the
normal update and drift check.

The [tool identity CLI proof](proof/2026-10-08-pubpal-tool-identity/README.md)
records the regression fixture, captured results, and proof limits.

Provider-backed typed chat uses the agent in text-only mode via `/api/pub-pal/chat`.
The server opens its WebSocket. Voice opens a browser WebSocket from the signed URL.
Live proof after a real run: `node scripts/pubpal/prove-pal-text-tool.mjs --base-url https://pubmaxxing.com`.

`GET /api/pub-pal/chat` prepares the signed-in owner's opening without a provider session, including on keyless deployments.
A first typed greeting can request the same opening.
The opening uses confirmed past-night reports, the latest logged visit or the profile's favourite drink when the taste read permits it.
An unavailable memory read produces an explicit unavailable message.
An affirmative reply to a past-night opening asks for an area and a price per pint.
It never converts reported expenditure into a pint budget.
Voice uses the same opening builder in its first-message override.
[ADR 0016](adr/0016-pub-pal-confirmed-memory-recall.md) owns confirmed-memory access.

1. **Hosted LLM** (`gemini-2.5-flash-lite` by default) on the ElevenLabs plan.
2. **Webhook tools** for the ADR 0014 allowlist (same handlers as `/api/ask`).
   Each tool sets `pre_tool_speech: "force"` and `execution_mode: "immediate"`,
   so the Pal says one short checking line while the tool runs instead of
   staying silent until it returns. The four confirm tools (`propose_plan`,
   `propose_map_action`, `report_occupancy`, `propose_memory`) set `interruption_mode:
   "disable_during_tool_and_turn"` so the proposal is heard whole. Typed chat
   answers when a reply has settled: no tool event followed it for 1.2 seconds,
   or 0.4 seconds after `agent_response_complete` when the agent sends it. A
   reply that came before a tool event is the checking line, so typed chat drops
   it and waits for the reply after the tool. The script adds the tool events
   and `agent_response_complete` to the agent's `conversation.client_events`,
   so the captain re-runs `npm run pubpal:agent` to turn them on. Typed chat
   works on an agent with or without them, so the deploy and the re-run can
   happen in either order. One window stays open until the re-run: an agent
   that sends no `agent_tool_request` cannot say a tool is still running, so a
   slow tool's checking line that outlasts the settle window would be returned
   as the answer. `npm run pubpal:agent -- --check` reports whether the live
   agent matches this config.
   Voice also needs `agent_tool_response_full_payload` to show the actual
   returned pub cards, their fitted map and memory-confirmation cards. The
   browser uses the tool result, never pub names or prices parsed from speech.
   Requests for one to six pubs pass a result count to `search_venues`.
   An upper pint-price limit filters eligible records before ranking.
   The script also sets how the agent hears a person in a pub. Turn-taking is
   `turn_eagerness: "patient"`, so a pause in the middle of a sentence does not
   end the person's turn. `transcribe_on_disabled_interruptions: true` keeps
   what the person says while a confirm proposal plays, because those turns
   cannot be talked over and the words were dropped before. The recogniser gets
   a short list of London pub words (`asr.keywords`). Until the captain re-runs
   `npm run pubpal:agent`, `--check` reports these fields as drift.
   Typed chat can also stream. A caller that sends `Accept: application/x-ndjson`
   to `/api/pub-pal/chat` gets the answer text as the agent writes it
   (`agent_chat_response_part`, which text-only mode always sends), then one
   `final` line carrying the same body the JSON path returns, cards and
   proposals included. Sign-in, the rate limit and the spend ceiling answer
   before the stream opens. Any other caller still gets one JSON body.
   One more webhook, `recall_memories`, is Pal-only. It returns the memories the
   person confirmed or corrected (never `completed_plan` rows) for the account
   that opened the conversation, read from the server-side conversation binding
   and never from the request body. Typed chat puts the same lines ahead of the
   ask on the server, or one line saying nothing is confirmed, so it does not
   need the tool. [ADR 0016](adr/0016-pub-pal-confirmed-memory-recall.md) owns
   confirmed-memory access, past-night reports and the confirmation rule.
   A second Pal-only webhook, `propose_memory`, adds a memory card
   to a typed or voice chat for the bound account, only when that Pal has memory
   proposals on. They are on for a new Pal; a Pal saved with them off keeps
   them off. Voice displays the card from `agent_tool_response_full_payload`.
   Ask-tool responses include a `requestedTool` receipt. This binds a canonical result,
   such as venue discovery returned for a price request, to its original SDK tool call.
   Before the card is made, `lib/palMemoryRelation.server.ts` sorts the fact against the person's
   confirmed memories: a fact they already have makes no card, and one that
   replaces or withdraws a memory makes an "Update" or "Forget" card that
   PATCHes or DELETEs that memory on Confirm. The card sends the value it
   showed as replaced, and the route answers 409 when the memory has changed
   since, so a stale card never overwrites a newer fact. Without a TypeSafe key only exact
   duplicates are caught and every other offer is an ordinary card. Typed chat also carries
   recent turns through `windowPalSessionTurns` in `lib/palSessionSummary.ts`.
   It resolves same-area pint-budget references before older turns leave the window.
   Older user asks form a rolling session summary turn capped at 300 UTF-8 bytes, label included.
   A byte-level BPE token always covers at least one byte, so the turn is at
   most 300 tokens for any input. It is built only from the person's own older
   asks and never used as a fact source.
   Both paths also carry a **taste read** (`lib/palTaste.ts`, read by
   `lib/palTaste.server.ts`) from the verified owner's declared favourite drink
   and their own records: diary visits and ratings, pint drops (drink, pint
   price, vibe tags) and saved pubs. Typed chat puts it after the
   memories, in the person's voice; voice gets it inside the `recall_memories`
   answer. It runs beside the signed-URL request with a 900 ms budget and a
   two-minute in-process cache, so a turn does not wait on it, and a slow or
   empty read sends no lines, which the prompt reads as "ask, do not guess".
   It is opt-out: the "Taste read" toggle on the Pal's page writes
   the `taste` key of `proposal_preferences` (inside the existing jsonb, so no migration;
   a missing key is on). The setting is read fresh before every read, so
   turning it off stops the next turn reading the favourite drink or logs, past the cache, and a
   Pal that cannot be read fails closed.
   Without ElevenLabs keys, a signed-in ask with no area, mood or budget runs
   `search_venues` off the read's patch, vibe and usual price instead of
   asking for one.
3. **Voices** and per-session `voice_id` overrides (unchanged).
4. **House prompt**: talk like a best mate who knows their taste, a quick
   pick answers at once and a plan asks up to three short questions first,
   call tools before any fact, never invent a price, propose then confirm,
   plain speech on get-home topics. A prompt change reaches the live agent only
   when the captain re-runs `npm run pubpal:agent`.
5. **Signed-URL authentication** (`platform_settings.auth.enable_auth`): a
   conversation starts only from a signed URL the app issued, after sign-in,
   the voice cap and the spend ceiling. The agent id alone is refused.
   ElevenLabs treats signed URLs and a hostname allowlist as exclusive methods,
   so the script writes an empty `allowlist` and removes any list the agent
   kept. The drift check reports a leftover list.

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

## Diagnosing typed-chat failures

`lib/palElevenLabsChat.server.ts` emits private `pub_pal.chat_failed` warnings
with a failure code, stage, elapsed milliseconds and an optional signed-session reason.
Caller cancellation does not emit this warning.
The diagnostic excludes prompts, transcripts, URLs, headers, secrets and personal data.
It does not change the public error response or establish a provider failure's cause.

---

## Checking it

Local builds, tests and controlled provider sockets do not establish live voice recall or production agent configuration.
Provider access and the production workspace remain unresolved for this change.
Live voice recall, physical-device acceptance, deployment and exhaustive website acceptance remain unverified.
The checks below require separate provider access and do not resolve those limits by themselves.

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
explain itself before the tap. `POST` still needs a signed-in caller and prepays
a three-minute grant (`lib/palVoiceMetering.ts`). The server settles that grant
from the call length ElevenLabs records, never from a duration the browser
sends. When the browser releases a session, the server asks ElevenLabs for up
to five seconds until it reports the call ended. If the call is still running
then, the grant stays charged at three minutes until the same account next
asks for voice: that request settles it before the allowance check. A call
ElevenLabs never reports as ended stays charged at three minutes. Migration
`0176` must be applied before the deploy that calls it.

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
