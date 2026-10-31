#!/usr/bin/env node
// Create or update the Pub Pal ElevenLabs Agent, idempotently.
//
// The agent is a THIN SHELL. Factual answers come from the webhook tools.
// Grounding stays in the base prompt. The browser may change the greeting
// and the voice id. It may not replace the system prompt.
// Captain, after this file changes, re-run once. Do not do this from an agent:
//   npm run pubpal:agent -- --base-url https://pubmaxxing.com
//
// This script sets six things:
//
//   1. the webhook tools, the shared secret they present, and the speech
//      around each call (a short checking line before the tool runs),
//   2. no voice recording, and zero retention on the provider side, plus the
//      client events voice and typed chat read,
//   3. a default voice, when one is set, plus greeting and voice-id overrides,
//   4. the house first message and the propose-then-confirm rule (ADR 0006),
//   5. signed-URL authentication, so a conversation starts only with a URL the
//      sign-in, the voice cap and the spend budget handed out,
//   6. how the agent hears a person in a pub: patient turn-taking, speech kept
//      during a proposal, and London pub words for the recogniser.
//
// Idempotent: with ELEVENLABS_PUB_PAL_AGENT_ID set it PATCHes that agent;
// without one it looks for an agent of the same name before creating a new
// one, so a re-run never leaves two Pals in the dashboard.
//
// Usage:
//   node scripts/pubpal/create-elevenlabs-agent.mjs --base-url https://pubmaxxing.com
//   node scripts/pubpal/create-elevenlabs-agent.mjs --dry-run
//   node scripts/pubpal/create-elevenlabs-agent.mjs --check --base-url https://pubmaxxing.com
//
// --check only reads: it GETs the live agent and tools, compares them with what
// a real run would write, and exits 1 on any drift. Safe from any session.
//
// Reads .env.local / .env if present, so a local run needs no exported shell
// variables. See docs/PUB_PAL_SETUP.md.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PAL_VOICE_MAX_SESSION_SECONDS } from "../../lib/palVoiceCap.mjs";
import { pubPalAgentSystemPrompt } from "../../lib/palVoicePrompt.mjs";
import { PUB_PAL_TOOL_DESCRIPTIONS, pubPalToolArgumentProperties } from "../../lib/pubPalToolCatalog.mjs";
import { agentDrift, formatDrift } from "./agent-drift.mjs";
import { resolveExistingTools } from "./existing-tools.mjs";
import { privacyDeleteOnly } from "./privacy-delete-only.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_CONFIG = JSON.parse(
  readFileSync(path.join(SCRIPT_DIR, "pub-pal-agent-config.json"), "utf8"),
);

const API = "https://api.elevenlabs.io/v1/convai";
const TOOLS_API = `${API}/tools`;
const SECRETS_API = "https://api.elevenlabs.io/v1/convai/secrets";
const LLM_SECRET_NAME = "PUBMAXX_PUB_PAL_LLM_SECRET";
const AGENT_NAME = "PUBMAXX Pub Pal";
const MAX_SESSION_SECONDS = PAL_VOICE_MAX_SESSION_SECONDS;

const TOOL_DESCRIPTIONS = PUB_PAL_TOOL_DESCRIPTIONS;

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function systemPrompt() {
  return pubPalAgentSystemPrompt(MAX_SESSION_SECONDS);
}

function conversationIdProperty() {
  return {
    type: "string",
    dynamic_variable: "system__conversation_id",
  };
}

// The webhook body: the conversation id ElevenLabs fills in, then the tool's
// own arguments from the shared catalog.
function webhookBodyProperties(name) {
  return {
    conversation_id: conversationIdProperty(),
    ...pubPalToolArgumentProperties(name),
  };
}

// Events the agent sends to a client. The voice session needs the first
// seven. Typed chat needs the tool events and agent_response_complete to tell
// a checking line from the answer. A PATCH replaces the whole list, so an
// update keeps whatever the agent already sends.
const CLIENT_EVENTS = [
  "conversation_initiation_metadata",
  "ping",
  "audio",
  "interruption",
  "user_transcript",
  // The voice panel prints the words as they are heard (lib/palVoiceTranscript.ts).
  "tentative_user_transcript",
  "agent_response",
  "agent_response_correction",
  "agent_tool_request",
  "agent_tool_response",
  "agent_tool_response_full_payload",
  "agent_response_complete",
];

// How the agent hears a person. The provider's defaults are tuned for a quick
// phone line; a pub is loud and people pause mid-sentence ("somewhere in...
// Soho"). Left at the defaults, the agent took the turn at that pause, so the
// rest of the sentence arrived as a talk-over and the answer was to half of it.
//
// - `turn_eagerness: "patient"` waits longer at a pause before it answers.
// - `transcribe_on_disabled_interruptions: true` keeps what the person says
//   while a confirm proposal plays. The four confirm tools disable talk-over
//   for their whole turn (ADR 0006), and without this flag every word spoken
//   in that turn was dropped, not carried into the next one.
// - `keywords` bias the recogniser to the names a London night uses. Only
//   words that are hard to hear and common in asks go here, not a gazetteer.
// - `quality` and `user_input_audio_format` restate the provider's defaults,
//   so `--check` reports a dashboard change that would make the Pal hear worse.
const PAL_TURN_CONFIG = {
  turn_eagerness: "patient",
  transcribe_on_disabled_interruptions: true,
};

const PAL_ASR_KEYWORDS = [
  "PUBMAXX",
  "Pub Pal",
  "pint",
  "Guinness",
  "Spoons",
  "Wetherspoons",
  "Sam Smith's",
  "Fuller's",
  "Young's",
  "Greene King",
  "real ale",
  "cask",
  "pub crawl",
  "last train",
  "night bus",
  "Soho",
  "Camden",
  "Shoreditch",
  "Clerkenwell",
  "Fitzrovia",
  "Covent Garden",
  "Borough",
  "Bermondsey",
  "Peckham",
  "Brixton",
  "Hackney",
  "Dalston",
  "Islington",
  "Marylebone",
];

const PAL_ASR_CONFIG = {
  quality: "high",
  user_input_audio_format: "pcm_16000",
  keywords: PAL_ASR_KEYWORDS,
};

function clientEvents(existing) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...CLIENT_EVENTS])];
}

// Tools that end in a confirm proposal. The person may not talk over the
// proposal, or they miss what they are asked to confirm (ADR 0006).
const CONFIRM_PROPOSAL_TOOLS = new Set([
  "propose_plan",
  "propose_map_action",
  "report_occupancy",
  "propose_memory",
]);

// Speech around a tool call. "force" makes the agent say its one short
// checking sentence before every tool runs, so the first audio does not wait
// for the tool. "auto" only speaks once the provider has seen a slow tool, so
// the first slow answer of a call was silent. "immediate" runs the tool while
// that sentence plays.
function toolSpeechConfig(name) {
  return {
    pre_tool_speech: "force",
    execution_mode: "immediate",
    interruption_mode: CONFIRM_PROPOSAL_TOOLS.has(name) ? "disable_during_tool_and_turn" : "allow",
  };
}

function webhookToolConfig(name, baseUrl, secretId) {
  const description = TOOL_DESCRIPTIONS[name] ?? "PUBMAXX grounded tool.";
  return {
    type: "webhook",
    name,
    description,
    response_timeout_secs: 28,
    ...toolSpeechConfig(name),
    api_schema: {
      url: `${baseUrl}/api/pub-pal/tools/${name}`,
      method: "POST",
      request_headers: {
        "x-elevenlabs-llm-secret": { secret_id: secretId },
        "Content-Type": "application/json",
      },
      request_body_schema: {
        type: "object",
        properties: webhookBodyProperties(name),
      },
    },
  };
}

async function listWorkspaceTools(apiKey) {
  const listed = await call("GET", `${TOOLS_API}?page_size=100`, apiKey);
  if (listed.has_more) fail("Workspace tool list is incomplete. Refusing tool resolution before any update.");
  return Array.isArray(listed.tools) ? listed.tools : [];
}

function wantedWebhookTools(baseUrl, secretId) {
  return Object.fromEntries(
    (AGENT_CONFIG.toolNames ?? []).map((name) => [name, webhookToolConfig(name, baseUrl, secretId)]),
  );
}

async function ensureWebhookTools(apiKey, wantedTools, resolvedTools) {
  const ids = [];
  for (const [name, tool_config] of Object.entries(wantedTools)) {
    const hit = resolvedTools[name];
    const payload = { tool_config };
    if (hit?.id) {
      await call("PATCH", `${TOOLS_API}/${hit.id}`, apiKey, payload);
      ids.push(hit.id);
    } else {
      const created = await call("POST", TOOLS_API, apiKey, payload);
      if (!created.id) fail(`ElevenLabs returned no tool id for ${name}.`);
      ids.push(created.id);
    }
  }
  return ids;
}

function agentBody(toolIds) {
  const defaultVoice =
    process.env.ELEVENLABS_VOICE_FOX?.trim() ||
    process.env.ELEVENLABS_VOICE_ROBIN?.trim() ||
    process.env.ELEVENLABS_VOICE_EMBER?.trim() ||
    null;
  const body = {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt(),
          llm: AGENT_CONFIG.llm,
          reasoning_effort: AGENT_CONFIG.reasoning_effort,
          tool_ids: toolIds,
        },
        first_message: "Hello, I'm your Pub Pal. What kind of night are you planning?",
        language: "en",
      },
      conversation: {
        max_duration_seconds: MAX_SESSION_SECONDS,
        client_events: clientEvents(),
      },
      asr: structuredClone(PAL_ASR_CONFIG),
      turn: { ...PAL_TURN_CONFIG },
      ...(defaultVoice ? { tts: { voice_id: defaultVoice } } : {}),
    },
    platform_settings: {
      // Without this the agent id alone starts a conversation, and the agent id
      // is a query parameter in every signed URL the app hands out.
      // ElevenLabs treats signed URLs and an allowlist as exclusive methods, so
      // the empty allowlist replaces any hostname list the agent kept.
      auth: { enable_auth: true, allowlist: [] },
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: false },
            first_message: true,
          },
          tts: { voice_id: true },
          // Typed chat starts the same agent in text-only mode.
          conversation: { text_only: true },
        },
      },
      privacy: {
        record_voice: false,
        retention_days: -1,
        delete_transcript_and_pii: true,
        zero_retention_mode: true,
      },
    },
  };
  return { body, defaultVoice };
}

function redactToolConfig(config) {
  return {
    ...config,
    api_schema: {
      ...config.api_schema,
      request_headers: {
        "x-elevenlabs-llm-secret": { secret_id: "redacted" },
        "Content-Type": "application/json",
      },
    },
  };
}

function redactAgentPreview(body, baseUrl) {
  return {
    ...body,
    webhook_tools: (AGENT_CONFIG.toolNames ?? []).map((name) =>
      redactToolConfig(webhookToolConfig(name, baseUrl, "redacted")),
    ),
    llm: AGENT_CONFIG.llm,
    llmCreditNote: AGENT_CONFIG.llmCreditNote,
  };
}

async function ensureWorkspaceLlmSecret(apiKey, secretValue) {
  const listed = await call("GET", SECRETS_API, apiKey);
  const rows = Array.isArray(listed.secrets) ? listed.secrets : [];
  const hit = rows.find((row) => row?.name === LLM_SECRET_NAME);
  if (hit?.secret_id) {
    await call("PATCH", `${SECRETS_API}/${hit.secret_id}`, apiKey, {
      type: "update",
      name: LLM_SECRET_NAME,
      value: secretValue,
    });
    return hit.secret_id;
  }
  const created = await call("POST", SECRETS_API, apiKey, {
    type: "new",
    name: LLM_SECRET_NAME,
    value: secretValue,
  });
  if (!created.secret_id) fail("ElevenLabs returned no workspace secret id.");
  return created.secret_id;
}

async function call(method, url, apiKey, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "xi-api-key": apiKey,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`${method} ${url} answered ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

function mergeConversationConfigOverride(existing, desired) {
  if (!existing) return desired;
  return {
    ...existing,
    ...desired,
    agent: {
      ...(existing.agent ?? {}),
      ...(desired.agent ?? {}),
      prompt: {
        ...(existing.agent?.prompt ?? {}),
        ...(desired.agent?.prompt ?? {}),
      },
    },
    tts: { ...(existing.tts ?? {}), ...(desired.tts ?? {}) },
  };
}

function mergeAgentPatch(existingAgent, body) {
  const existingOverride =
    existingAgent.platform_settings?.overrides?.conversation_config_override;
  const desiredOverride =
    body.platform_settings?.overrides?.conversation_config_override;
  if (!desiredOverride) return body;
  return {
    ...body,
    platform_settings: {
      ...existingAgent.platform_settings,
      ...body.platform_settings,
      auth: { ...existingAgent.platform_settings?.auth, ...body.platform_settings.auth },
      overrides: {
        ...existingAgent.platform_settings?.overrides,
        ...body.platform_settings.overrides,
        conversation_config_override: mergeConversationConfigOverride(
          existingOverride,
          desiredOverride,
        ),
      },
    },
  };
}

/** The PATCH a run sends to an existing agent: the live agent with this repo's fields laid over it. */
function agentPatch(currentAgent, toolIds) {
  const { body } = agentBody(toolIds);
  const conversationConfig = structuredClone(currentAgent.conversation_config ?? {});
  conversationConfig.agent = {
    ...(conversationConfig.agent ?? {}),
    prompt: {
      ...(conversationConfig.agent?.prompt ?? {}),
      ...body.conversation_config.agent.prompt,
      custom_llm: null,
    },
    first_message:
      conversationConfig.agent?.first_message ??
      "Hello, I'm your Pub Pal. What kind of night are you planning?",
    language: conversationConfig.agent?.language ?? "en",
  };
  delete conversationConfig.agent.prompt.custom_llm;
  delete conversationConfig.agent.prompt.tools;
  conversationConfig.conversation = {
    ...(conversationConfig.conversation ?? {}),
    max_duration_seconds: MAX_SESSION_SECONDS,
    client_events: clientEvents(conversationConfig.conversation?.client_events),
  };
  // Laid over the live sections, so a dashboard-only setting there is kept.
  conversationConfig.asr = { ...(conversationConfig.asr ?? {}), ...structuredClone(PAL_ASR_CONFIG) };
  conversationConfig.turn = { ...(conversationConfig.turn ?? {}), ...PAL_TURN_CONFIG };
  return mergeAgentPatch(currentAgent, {
    ...body,
    conversation_config: conversationConfig,
  });
}

async function findAgentByName(apiKey) {
  const listed = await call("GET", `${API}/agents?page_size=100`, apiKey);
  const rows = Array.isArray(listed.agents) ? listed.agents : [];
  const hit = rows.find((row) => row?.name === AGENT_NAME);
  return hit?.agent_id ?? null;
}

/** Read-only: GETs only, so it cannot change the live agent. Exits 1 on drift. */
async function checkAgent(apiKey, baseUrl) {
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim() || (await findAgentByName(apiKey));
  if (!agentId) fail(`No agent named ${AGENT_NAME} and ELEVENLABS_PUB_PAL_AGENT_ID is not set.`);
  const liveAgent = await call("GET", `${API}/agents/${agentId}`, apiKey);
  const liveTools = await listWorkspaceTools(apiKey);
  const secrets = await call("GET", SECRETS_API, apiKey);
  const secretId =
    (Array.isArray(secrets.secrets) ? secrets.secrets : []).find((row) => row?.name === LLM_SECRET_NAME)
      ?.secret_id ?? null;
  const wantedTools = wantedWebhookTools(baseUrl, "unused");
  const resolvedTools = resolveExistingTools(liveTools, liveAgent.conversation_config?.agent?.prompt?.tool_ids, wantedTools);
  const liveToolIds = Object.values(resolvedTools)
    .map((row) => row?.id)
    .filter(Boolean);
  const drifts = agentDrift({
    liveAgent,
    liveTools,
    wantedAgent: agentPatch(liveAgent, liveToolIds),
    wantedTools,
    secret: { name: LLM_SECRET_NAME, id: secretId },
  });
  console.log(`Checked agent ${agentId} against this repo's config (read-only).`);
  if (drifts.length === 0) {
    console.log("✓ The live agent matches.");
    return;
  }
  for (const drift of drifts) console.log(formatDrift(drift));
  console.log(
    `\n✗ ${drifts.length} difference${drifts.length === 1 ? "" : "s"}. The captain re-runs: npm run pubpal:agent -- --base-url ${baseUrl}`,
  );
  process.exit(1);
}

async function main() {
  if (process.argv.includes("--privacy-delete-only")) {
    if (process.argv.includes("--check") || process.argv.includes("--dry-run")) {
      fail("--privacy-delete-only cannot be combined with --check or --dry-run.");
    }
    await privacyDeleteOnly({
      agentId: arg("agent-id"),
      branchId: arg("branch-id"),
      attestationFile: arg("privacy-attestation"),
      apiKey: process.env.ELEVENLABS_API_KEY?.trim(),
    });
    return;
  }
  loadDotEnv();

  const dryRun = process.argv.includes("--dry-run");
  const check = process.argv.includes("--check");
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const secret = process.env.ELEVENLABS_LLM_SHARED_SECRET?.trim();
  const baseUrl = (arg("base-url", process.env.PUBMAX_BASE_URL ?? "")).trim().replace(/\/+$/, "");

  if (!dryRun && !apiKey) fail("ELEVENLABS_API_KEY is not set. See docs/PUB_PAL_SETUP.md.");
  if (!secret && !check) fail("ELEVENLABS_LLM_SHARED_SECRET is not set. Generate one: openssl rand -hex 32");
  if (!baseUrl) fail("Pass --base-url https://your-deployment (or set PUBMAX_BASE_URL).");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost/.test(baseUrl)) {
    fail(`--base-url must be https (or http://localhost for a tunnel test). Got: ${baseUrl}`);
  }

  if (check) {
    await checkAgent(apiKey, baseUrl);
    return;
  }

  if (dryRun) {
    const toolIds = (AGENT_CONFIG.toolNames ?? []).map((name) => `dry-run-tool:${name}`);
    const { body, defaultVoice } = agentBody(toolIds);
    console.log(
      "Dry run. This is the agent that would be written (secrets and tool ids held back):\n",
    );
    console.log(JSON.stringify(redactAgentPreview(body, baseUrl), null, 2));
    console.log("\nDefault voice resolved:", defaultVoice);
    console.log("\nLLM:", AGENT_CONFIG.llm, "-", AGENT_CONFIG.llmCreditNote);
    return;
  }

  const existing = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim() || (await findAgentByName(apiKey));
  const currentAgent = existing ? await call("GET", `${API}/agents/${existing}`, apiKey) : null;
  const liveTools = await listWorkspaceTools(apiKey);
  // Resolve every identity before the first secret, tool or agent write.
  const resolvedTools = resolveExistingTools(liveTools, currentAgent?.conversation_config?.agent?.prompt?.tool_ids, wantedWebhookTools(baseUrl, "unused"));
  const secretId = await ensureWorkspaceLlmSecret(apiKey, secret);
  const toolIds = await ensureWebhookTools(apiKey, wantedWebhookTools(baseUrl, secretId), resolvedTools);
  const { body, defaultVoice } = agentBody(toolIds);

  if (existing) {
    await call("PATCH", `${API}/agents/${existing}`, apiKey, agentPatch(currentAgent, toolIds));
    console.log(`✓ Updated agent ${existing}`);
    console.log(`  LLM: ${AGENT_CONFIG.llm}`);
    console.log(`  Webhook tools: ${toolIds.length}`);
  } else {
    const created = await call("POST", `${API}/agents/create`, apiKey, body);
    const agentId = created.agent_id ?? created.id;
    if (!agentId) fail("ElevenLabs returned no agent id.");
    console.log(`✓ Created agent ${agentId}`);
    console.log(`  LLM: ${AGENT_CONFIG.llm}`);
    console.log(`\n  Set this on the deployment:\n    ELEVENLABS_PUB_PAL_AGENT_ID=${agentId}`);
  }

  if (!defaultVoice) {
    console.log(
      "\n  No default voice id set (ELEVENLABS_VOICE_FOX, _ROBIN or _EMBER). The agent keeps its ElevenLabs default.",
    );
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
