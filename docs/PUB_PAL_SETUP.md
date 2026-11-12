# Pub Pal setup: text now, voice when you switch it on

Pub Pal typed chat and map Ask both work without provider keys.
Typed chat uses `/api/pub-pal/chat`. Map Ask uses `/api/ask`.
Both use grounded `runAsk` tools on the keyless path.
[ADR 0014](adr/0014-night-os-ask-agent.md) owns the deterministic menu and price routing that precedes provider selection.

## Typed chat on Claude

Typed chat can run on Claude instead of the ElevenLabs agent. Voice stays on
ElevenLabs.

1. Create a Claude Platform API key in the account that holds the intended credits.
2. Set `ANTHROPIC_API_KEY` on the deployment (server-only).
3. Optional: set `PUB_PAL_CLAUDE_MODEL` for both Pub Pal typed chat and map Ask. The default is `claude-haiku-5-5`.

Set a monthly spend limit in the Claude Console.

When the key is set, `/api/pub-pal/chat` sends each typed ask to Claude
(`lib/palClaudeChat.server.ts`). It needs a signed-in session and spends the
same `pub-pal-chat` ceiling. The safety fence, the answers from records, the
memories and the taste read run before Claude is asked, as they do for
ElevenLabs. Claude uses the same tools (`lib/pubPalToolCatalog.mjs`) and the
same prompt rules (`lib/palVoicePrompt.mjs`, without the spoken parts). Our
server runs each tool itself, so no webhook is involved.

The same key also moves map Ask's model loop (`/api/ask`) from OpenRouter to
Claude. Both paths use the shared client, model setting and prompt cache
markers (`lib/claudeClient.server.ts`). Ask spends the `ask` ceiling.

Without a Claude key, typed chat uses the configured ElevenLabs agent, or the keyless tools when ElevenLabs is not configured.
Map Ask uses OpenRouter when its key is set, or the keyless tools otherwise.
A failed Claude request does not switch to another paid provider.
Map Ask retains completed tool results or uses its keyless fallback. Typed chat returns its existing failure response.

Text and voice share the source-backed server tool registry.
Voice also has browser map tools, described under [Creating the agent](#creating-the-agent).
[ADR 0014, decision 3](adr/0014-night-os-ask-agent.md#decision) owns action confirmation, including the live voice exception for view moves.

---

## What works with no keys

| Surface | Keyless | Notes |
|---|---|---|
| `/pal/chat` text ask | Yes | `/api/pub-pal/chat`. The provider rules above apply when keys are set |
| Map Ask | Yes | Same `/api/ask` path |
| Concierge tools (prices, tonight, drinks, desk, crowd) | Yes | Every one of them reads a lane we already hold |
| Model tool selection | Keyless regex | The provider rules above apply when keys are set |
| Reader wording | Yes | Keyless replies and map Ask use returned rows and hints. Provider-backed Pal chat uses the shared prompt rules |
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

It reads `scripts/pubpal/pub-pal-agent-config.json` (model, server tool allowlist)
and registers the browser tools from [`lib/palMapClientTools.mjs`](../lib/palMapClientTools.mjs).
Without `--branch-id`, it PATCHes the agent and its workspace tools.
Each webhook calls
`<base-url>/api/pub-pal/tools/{name}` with `ELEVENLABS_LLM_SHARED_SECRET`
(stored in the workspace vault as `PUBMAXX_PUB_PAL_LLM_SECRET`), waits up to
28 seconds for a response (`response_timeout_secs` in the script; the route
allows 30 seconds via `maxDuration`). Deploying the app alone does not change
the system prompt, the override grants, a tool schema, or the timeout on an
agent that already exists. The captain re-runs
`npm run pubpal:agent -- --base-url https://pubmaxxing.com` after those
changes. Do not run that command from an agent session.

The map tools run in the voice browser through `client_tool_call`.
They set `expects_response: true` and `pre_tool_speech: "off"`, so the agent waits for the browser's answer but announces no tool check.
[`lib/palMapClientToolCall.ts`](../lib/palMapClientToolCall.ts) owns pick and area validation.
The agent receives a refusal as the tool result before it describes the map.
These tools are absent from the typed server tool catalog.
The ElevenLabs typed fallback still uses the shared agent.
If it receives a client tool call, it returns an error that asks the agent to answer in words.

Update and `--check` resolve each tool by the same identity rule. The script
first reads the existing agent and its attached tool IDs. It keeps the unique
attached tool for each name. Without `--branch-id`, an update writes a changed
webhook endpoint to that same tool ID. Check reports a different URL as drift without writing.
Same-name workspace duplicates cannot replace that attachment.

Without an attached match, the script reuses one compatible workspace webhook.
Its URL must exactly match `<base-url>/api/pub-pal/tools/{name}`.
Without an attached client tool, update creates one. It never reuses an unattached same-name client tool.
If no compatible tool exists, update creates one and check reports it as missing.
Multiple attached matches or multiple compatible workspace matches cause a
refusal. An incompatible attached type, an unknown attached ID, or an incomplete
workspace tool list also causes a refusal. Update resolves all identities before
writing a secret, a tool, or the agent. Other tool settings remain part of the
normal update and drift check.

The [tool identity CLI proof](https://github.com/Singularityszn/pubmax/blob/9ca837207f9bca5e8bba45dc967656d9d1bc7384/docs/proof/2026-10-08-pubpal-tool-identity/README.md)
records the regression fixture, captured results, and proof limits.

For branch proof, use an existing non-Main branch ID after the captain authorises the provider operation.
The update refuses Main or a branch whose returned identity differs from the requested ID.

```bash
npm run pubpal:agent -- --branch-id BRANCH_ID --base-url https://your-test-tunnel.example
npm run pubpal:agent -- --check --branch-id BRANCH_ID --base-url https://your-test-tunnel.example
```

A branch update preserves Main's attached tools and the workspace secret.
If a Main webhook differs only within `api_schema`, the branch gets a new tool ID.
This includes URL and argument schema changes.
Other drift in a Main-attached tool stops the update before any write.
Tools absent from Main can be updated in place. Their IDs can still be shared with other branches.
The agent name and `platform_settings`, including auth and privacy, are agent-wide.
A branch update neither sends nor checks those fields.
These commands configure and check a branch. They do not select a branch for the app's signed session URL.

ElevenLabs typed chat uses the agent in text-only mode via `/api/pub-pal/chat`.
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

1. **Hosted LLM** on the ElevenLabs plan. The [agent configuration](../scripts/pubpal/pub-pal-agent-config.json) owns the model and thinking budget.
2. **Webhook tools** for the ADR 0014 allowlist (same handlers as `/api/ask`).
   Each tool sets `pre_tool_speech: "force"` and `execution_mode: "immediate"`,
   so the Pal says one short checking line while the tool runs instead of
   staying silent until it returns. The four confirm tools (`propose_plan`,
   `propose_map_action`, `report_occupancy`, `propose_memory`) set `interruption_mode:
   "disable_during_tool_and_turn"` so the proposal is heard whole. Typed chat
   answers when a reply has settled and no observed tool request remains pending.
   The settle window is 1.2 seconds, or 0.4 seconds after `agent_response_complete`.
   A later tool event invalidates the earlier reply, except for a duplicate response to a completed observed request.
   That exception requires a nonempty call ID and no reopened request for that ID.
   First responses, unknown IDs, missing IDs and reopened requests still require a later reply.
   An `end_call` request or successful response preserves the latest eligible reply.
   If the provider then closes the socket, typed chat returns that reply.
   A failed `end_call`, a missing reply or an unfinished data tool still produces a provider failure on closure.
   `__tests__/palElevenLabsChat.server.test.ts` checks these sequences with simulated provider events.
   These tests do not establish the live provider sequence or resolution of a production timeout.
   The script adds the tool events
   and `agent_response_complete` to the agent's `conversation.client_events`,
   so the captain re-runs `npm run pubpal:agent` to turn them on. Typed chat
   works on an agent with or without them, so the deploy and the re-run can
   happen in either order. One window stays open until the re-run: an agent
   that sends no `agent_tool_request` cannot say a tool is still running, so a
   slow tool's checking line that outlasts the settle window would be returned
   as the answer. `npm run pubpal:agent -- --check` reports whether the live
   agent matches this config.
   Voice also needs `agent_tool_response_full_payload` to show the actual
   returned pub cards, their fitted map and memory-confirmation cards.
   The browser uses the tool result for pub identities, coordinates and prices.
   `onAudioAlignmentPlayback` supplies character timing when each audio chunk starts and skips interrupted chunks.
   `lib/palPickSpeech.ts` matches that played text against existing pick names, without creating new picks or price facts.
   The [Pub Pal feature guide](../README.md#features) owns the visible pick and price-card behaviour.
   For `search_venues` and `cheapest_pint_near`, the webhook forwards `result.data`.
   Returned pub coordinates use `venues` records with `id`, `lat` and `lng`.
   This includes the named-pub opening-hours variant of `search_venues`, even when current hours are unknown.
   Main-map picks use those coordinates without waiting for a separate browser venue index.
   `lib/palVoiceToolAnswer.ts` joins the coordinates to returned cards by venue ID.
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
   One more webhook, `recall_memories`, is Pal-only.
   [ADR 0016](adr/0016-pub-pal-confirmed-memory-recall.md#decision) owns
   confirmed-memory access, selection completeness, recall requirements and confirmation.
   The voice-token grant returns server-built memory and taste text in `context`.
   `PubPalVoiceSession` sends this text once with `sendContextualUpdate` when the call connects.
   A failed memory read omits memory text but can still supply taste text.
   The field is `null` when neither read supplies text.
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
   The browser loads this policy through `recentPalSessionTurns` in `lib/palSessionTurns.ts` when it needs to normalise history.
   It loads `refineRoutedAskQuery` on submission, before sending the request.
   The client deadline covers policy loading, the request, response reading and history normalisation.
   A newer request prevents an older request from publishing text or committing its result.
   Thread reads and writes in `lib/palChatThread.ts` are asynchronous and use the same history policy.
   Regression coverage includes `__tests__/palChatPolicyLoading.test.ts`, `__tests__/palChatClient.test.ts` and `__tests__/palChatThread.test.ts`.
   `windowPalSessionTurns` resolves same-area pint-budget references before older turns leave the window.
   Older user asks form a rolling session summary turn capped at 300 UTF-8 bytes, label included.
   A byte-level BPE token always covers at least one byte, so the turn is at
   most 300 tokens for any input. It is built only from the person's own older
   asks and never used as a fact source.
   Both paths also carry a **taste read** (`lib/palTaste.ts`, read by
   `lib/palTaste.server.ts`) from the verified owner's declared favourite drink
   and their own records: diary visits and ratings, pint drops (drink, pint
   price, vibe tags) and saved pubs. The "Saved but not tried yet" wishlist
   excludes pubs in the diary, pint drops or the "Been here" saved list.
   This exclusion applies even when another saved list contains the pub. "Been here" adds no
   dated visits or inferred visit patterns. Typed chat puts it after the
   memories, in the person's voice; voice gets it in the connect update and
   inside the `recall_memories` answer. It runs beside the signed-URL request with a 900 ms budget and a
   two-minute in-process cache, so a turn does not wait on it, and a slow or
   empty read sends no lines, which the prompt reads as "ask, do not guess".
   It is opt-out: the "Taste read" toggle on the Pal's page writes
   the `taste` key of `proposal_preferences` (inside the existing jsonb, so no migration;
   a missing key is on). The setting is read fresh before every read, so
   turning it off stops the next turn reading the favourite drink or logs, past the cache, and a
   Pal that cannot be read fails closed.
   New-place searches use `search_venues.onlyNew` from the shared tool catalog in typed and voice chat.
   `lib/pubPalToolInvoke.server.ts` resolves the owner through the conversation binding established by `bindPubPalToolTurn`.
   Deterministic typed answers use the authenticated owner and the same `palOnlyNewScope` helper.
   This separate exclusion read checks `palTasteAllowed` before reading history and does not use the taste summary's cache or 900 ms budget.
   `readPalVisitedVenues` resolves stored venue aliases and reads complete Pint Drop venue identities, including the owner's anonymous drops.
   The exclusion set stays on the server. ElevenLabs receives the filtered results and any fallback hint.
   The [Pub Pal usage guide](../README.md#pub-pal-new-picks) owns the request phrases and fallback messages.
   Without a typed-chat provider, a signed-in ask with no area, mood or budget runs
   `search_venues` off the read's patch, vibe and usual price instead of
   asking for one.
3. **Voices** and per-session `voice_id` overrides (unchanged).
4. **House prompt**: talk like a best mate who knows their taste, a quick
   pick answers at once and a plan asks up to three short questions first,
   call tools before any fact, never invent a price, propose then confirm,
   plain speech on get-home topics. A prompt change reaches the live agent only
   when the captain re-runs `npm run pubpal:agent`.
   [`lib/palVoicePrompt.mjs`](../lib/palVoicePrompt.mjs) owns the voice-only short-answer, map-tool, silence and goodbye rules.
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

ElevenLabs failures at stage `deadline` also include a `progress` snapshot.
The snapshot contains elapsed times, event counts, the pending tool count and reply eligibility.
The [progress type](../lib/palChatDeadlineProgress.ts) defines the fields.
Other failure stages and the Claude transport omit this snapshot.

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
The [map chip guide](../README.md#pub-pal-map-chip) explains how to start voice from the map.

On every start attempt, the app checks microphone access before requesting a
metered voice grant. The browser can show a permission prompt on the first tap.
A denied request keeps the writing door open and
can be retried. Repeated taps while voice starts use the same attempt.

When the voice session mounts on `/pal`, it preloads the two same-origin
worklets through `lib/elevenlabsWorkletAssets.ts`. The resampler still loads only
when the device needs it.

The SDK delay override in `lib/pubPalVoiceSession.ts` removes the default
Android audio-mode wait. Microphone access, the grant request and the SDK
connection still take time. Android audio routing needs
[real-phone verification](https://github.com/Singularityszn/pubmax/issues/2741).

### Voice audio cues and routing

Each voice start tap plays a short chime before microphone permission or a voice
grant arrives. This includes **Start voice chat**, **Carry on**, and the map's
[talk chip](../README.md#pub-pal-map-chip). The map chip plays its chime before the session
module downloads. The session takes ownership of that chime without playing it
again.

A replacement map tap stops the previous chime. A cancelled request or failed
session download also stops the chime. The app stops any remaining start chime
before the SDK connection begins, so the cue cannot overlap the greeting.
Cancelling or ending the startup attempt also stops the chime.

A live call has separate cues when the line closes and when the map is on its way.
A typed map request without a live call is silent. Unmounting does not play a cue.
The cues use same-origin ElevenLabs sound effects, trimmed and levelled in
`public/sounds/pal/`. If playback fails, the call can still continue.

The app passes `preferHeadphonesForIosDevices: true` to the ElevenLabs SDK.
On iOS, the SDK requests a detected headphone microphone as its preferred input.
Without a matching device, it uses the default microphone constraints.
This preference does not guarantee physical audio routing.
An iPhone check with AirPods remains pending in
[issue 2741](https://github.com/Singularityszn/pubmax/issues/2741).

### Voice interruptions

Client navigation between `/pal` and `/map`, including `/map/` subroutes, keeps
the same call and socket open. `PalVoiceHost` holds the session in the root
shell. On the map, `PalVoiceBar` shows the call status and newest transcript line.
**End** stops a live call. **Cancel** stops a pending startup attempt,
and stops its microphone at once (see SDK startup below). Returning to `/pal` restores the full transcript panel
without starting another call. A cold `/map` loads no ElevenLabs SDK until you tap to talk.

Before the session consumes a map-chip tap, leaving `/pal` and `/map` routes,
changing accounts, hiding the page, or `pagehide` cancels the pending request.
Returning requires another tap. `lib/palVoiceHost.ts` owns this pending state.

A connected call ends when you navigate outside these routes, reload or close
the page, lock the screen, hide the browser tab, or background the native app.
Muting or deleting the Pal, signing out, or switching accounts also ends the call.
Ending a call requests [voice-grant settlement](#voice-grants) and clears its main-map picks and grounding.
It also clears the last voice camera request and cancels pending voice navigation.
The voice prompt asks the agent to check in once after silence.
If silence continues, the prompt asks for one short goodbye followed by `end_call`.
The [agent configuration](../scripts/pubpal/pub-pal-agent-config.json) owns `turn_timeout` and the provider backstop, `silence_end_call_timeout`.
The 180-second call cap remains. These settings reach an existing agent only after the captain runs the configuration command.

If a background interruption leaves the session mounted, it keeps the transcript
and offers **Carry on** when you return. When the Pal ends the call or the provider closes it for silence,
the panel shows a friendly end status and offers **Carry on**. On the map, **Close voice chat** dismisses
the stopped bar. **Carry on** starts a new call. Returning does not restart the
microphone automatically.

The first microphone permission prompt does not cancel startup while the native
app remains in the foreground. A hidden page or native background transition
cancels the startup attempt while microphone permission is pending. If permission
then arrives, the app stops the returned stream without requesting a voice grant.

The pinned ElevenLabs SDK cannot cancel startup once its connection is in
progress. The app keeps a microphone guard installed for the life of the page.
Each SDK microphone request uses the startup token that is current when the
request begins. Cancelling that token stops its held streams at once.
The guard refuses requests with a cancelled token. It also stops streams that
resolve after cancellation or while the page is hidden. SDK status changes do
not remove this guard. The app's own permission probe bypasses the guard.

If you start again, the app waits until the previous SDK startup reports
connected or disconnected. The startup timeout also limits this wait.
If an attempt claims its token but stops before the SDK starts, the app marks
that startup as finished. Later attempts do not wait for an SDK status change
from that attempt.
A new SDK startup becomes the current token. The SDK can still finish an old
connection. The app then closes the late session.

`components/pubpal/usePageLeft.ts` detects document hiding, `pagehide`, and native
`pause`. It ignores native foreground inactivity, which can include permission
prompts. `__tests__/pubPalVoice.test.tsx` covers these transitions with doubles.
These checks do not establish physical-device acceptance.

### Voice grants

`GET /api/pub-pal/voice-token` answers one boolean about this deployment's own
configuration and reads no account, which is the whole reason the Pal can
explain itself before the tap. Issuing a voice token follows the
[account age requirements](../README.md#pub-pal-age-requirements) before quota or provider allocation.
An accepted request prepays a three-minute grant (`lib/palVoiceMetering.ts`).
`prepay_pub_pal_voice_grant` checks the monthly allowance and charges the grant
atomically. Admission requires usage below `PAL_VOICE_MONTHLY_MINUTES`, rather
than room for the whole grant. Concurrent requests cannot bypass that check.

The browser's `durationSeconds` never changes the meter. A release names only
the issued `conversationId`. The server checks ownership with
`owns_issued_pub_pal_voice_conversation` before it asks ElevenLabs about the call.
An invented or already settled conversation causes no provider request.

`lib/pubPalVoiceProviderDuration.server.ts` accepts a final duration only for
provider states `processing`, `done`, or `failed`. During release, it asks
ElevenLabs again once a second for up to five seconds. If the provider cannot
confirm the call ended, the grant stays issued and charged in full.

An ordinary voice start does not wait for earlier calls to settle.
After a successful response, Next.js `after()` settles the owner's issued
grants for that month, excluding the new conversation. If prepayment initially
refuses admission, the request attempts settlement first, then retries prepayment
once regardless of the settlement result. This retry uses the database's
current usage even when a settlement reply was lost or another request settled
the grant. A provider timeout leaves the unsettled grant charged in full.
No cron or webhook settles voice grants.

`settle_pub_pal_voice_conversation` replaces the prepayment with the provider's
recorded duration, rounded up to started minutes. Zero seconds costs nothing.
A call beyond the cap charges the difference. Settlement applies once under
the caller's own grant. A repeated settlement cannot change the meter again.

A grant settles only from a final duration that ElevenLabs reports. An HTTP
404 does not settle the grant, however old the grant is. The agent runs in zero
retention mode, so a 404 can also come from a finished call whose record is
gone. A browser cancellation cannot prove that the signed URL was not used. A
running call, an unreadable provider response, or a missing final duration
also leaves the grant charged in full.

`refund_pub_pal_voice_grant` handles server failures before the server hands out
a signed URL. It accepts reserved or issued grants, including a link that
committed before its reply was lost. It rejects settled or already refunded
grants. An ambiguous prepayment result also triggers a refund, because the
database may already have committed the charge. Once the session is linked
and allocated, a failure to schedule `after()` does not refund that grant.

Migration `0176` restricts these operations to the service role and closes
`consume_pub_pal_voice_trial`, `release_pub_pal_voice_trial`, and
`record_pub_pal_voice_minutes` to that role. An older application therefore
cannot use the browser-trusted meter. The keyless in-memory meter prepays and
refunds grants but does not settle them.

The captain must apply `0176` before deploying code that calls it. A deployment
without the migration returns 503 and offers text. Roll back the application
before the migration, because its rollback reopens the browser-trusted meter.
This settlement change needs no new migration.

Regression coverage lives in `__tests__/pubPalVoiceTokenRoute.test.ts` and
`__tests__/pubPalVoiceGrantsMigrationEffective.test.ts`. The latter exercises
the route, concurrency, permissions, and rollback against PostgreSQL 16.

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
