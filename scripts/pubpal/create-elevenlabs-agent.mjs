#!/usr/bin/env node
// Create or update the Pub Pal ElevenLabs Agent, idempotently.
//
// The agent is a THIN SHELL. Factual answers come from the webhook tools.
// Grounding stays in the base prompt. The browser may change the greeting
// and the voice id. It may not replace the system prompt.
// Captain, after this file changes, re-run once. Do not do this from an agent:
//   npm run pubpal:agent -- --base-url https://pubmaxxing.com
//
// So this script sets four things and nothing else:
//
//   1. the webhook tools, the shared secret they present, and the speech
//      around each call (a short checking line before the tool runs),
//   2. no voice recording, and zero retention on the provider side, plus the
//      client events voice and typed chat read,
//   3. a default voice, when one is set, plus greeting and voice-id overrides,
//   4. the house first message and the propose-then-confirm rule (ADR 0006),
//   5. signed-URL authentication, so a conversation starts only with a URL the
//      sign-in, the voice cap and the spend budget handed out.
//
// Idempotent: with ELEVENLABS_PUB_PAL_AGENT_ID set it PATCHes that agent;
// without one it looks for an agent of the same name before creating a new
// one, so a re-run never leaves two Pals in the dashboard.
//
// Usage:
//   node scripts/pubpal/create-elevenlabs-agent.mjs --base-url https://pubmaxxing.com
//   node scripts/pubpal/create-elevenlabs-agent.mjs --dry-run
//
// Reads .env.local / .env if present, so a local run needs no exported shell
// variables. See docs/PUB_PAL_SETUP.md.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PUB_PAL_MEMORY_KINDS } from "../../lib/palMemoryKinds.mjs";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "../../lib/palVoiceCap.mjs";
import { pubPalAgentSystemPrompt } from "../../lib/palVoicePrompt.mjs";

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

/** Short descriptions aligned with lib/ask/tools.ts allowlist, plus the Pal-only memory tools. */
const TOOL_DESCRIPTIONS = {
  search_venues:
    "Rank listed pubs by mood, area, group size, and budget. Never invents venues.",
  whats_on:
    "Look up sourced What's On listings (quiz, sport, deals) for tonight or a weekday.",
  venue_heritage:
    "Retrieve on-record heritage facts for a named listed pub. Never invents history.",
  venue_prices:
    "Read listed and corroborated people-logged prices for a pub. Never invents figures.",
  city_status: "London live weather, tube, and city signals via CityMCP.",
  journey: "Transit journey between two points or listed pubs via CityMCP.",
  area_buzz: "Borough pint average and things to do tonight via CityMCP.",
  propose_plan:
    "Propose a three-stop draft from listed pubs. Saves nothing until the reader confirms in the app.",
  propose_map_action:
    "Propose opening a pub sheet or flying the map. User must confirm before anything moves.",
  cheapest_pint_near:
    "Cheapest listed pints around a named pub or London area. Never uses the reader's GPS.",
  tonight_now:
    "Sourced listings running now versus later tonight. Never claims live crowd levels.",
  venue_drinks:
    "Every drink logged at one listed pub with provenance. Never invents figures.",
  find_desk:
    "Places to sit and work from cafe, co-working and library rows only.",
  report_occupancy:
    "Propose a crowd report for a pub. Writes nothing until the reader confirms.",
  recall_memories:
    "Read the preferences this person confirmed for their Pal to remember. Read-only. Never facts about a pub.",
  propose_memory:
    "Typed chat only. Propose one preference for the Pal to remember. Saves nothing until the person confirms the card.",
};

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

const TOOL_WEBHOOK_BODY_PROPERTIES = {
  cheapest_pint_near: {
    conversation_id: conversationIdProperty(),
    query: {
      type: "string",
      description: "The user's full question when area or pub name are unclear.",
    },
    area: { type: "string", description: "London area or neighbourhood, e.g. Soho or Camden." },
    venueName: { type: "string", description: "Named pub to search around." },
  },
  propose_plan: {
    conversation_id: conversationIdProperty(),
    query: {
      type: "string",
      description: "The full crawl or plan ask, including area and stop count.",
    },
  },
  search_venues: {
    conversation_id: conversationIdProperty(),
    query: { type: "string", description: "The venue search ask." },
  },
  recall_memories: {
    conversation_id: conversationIdProperty(),
  },
  propose_memory: {
    conversation_id: conversationIdProperty(),
    kind: {
      type: "string",
      enum: [...PUB_PAL_MEMORY_KINDS],
      description: "What sort of preference this is.",
    },
    value: {
      type: "string",
      description: "The preference in the person's own words, one short line.",
    },
  },
};

const DEFAULT_WEBHOOK_BODY_PROPERTIES = {
  conversation_id: conversationIdProperty(),
  query: {
    type: "string",
    description: "The user's question this tool call should answer.",
  },
};

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
  "agent_response",
  "agent_response_correction",
  "agent_tool_request",
  "agent_tool_response",
  "agent_response_complete",
];

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
        properties:
          TOOL_WEBHOOK_BODY_PROPERTIES[name] ?? DEFAULT_WEBHOOK_BODY_PROPERTIES,
      },
    },
  };
}

async function listWorkspaceTools(apiKey) {
  const listed = await call("GET", `${TOOLS_API}?page_size=100`, apiKey);
  return Array.isArray(listed.tools) ? listed.tools : [];
}

async function ensureWebhookTools(apiKey, baseUrl, secretId, dryRun) {
  const names = AGENT_CONFIG.toolNames ?? [];
  if (dryRun) {
    return names.map((name) => `dry-run-tool:${name}`);
  }
  const existing = await listWorkspaceTools(apiKey);
  const ids = [];
  for (const name of names) {
    const hit = existing.find((row) => row?.tool_config?.name === name);
    const payload = { tool_config: webhookToolConfig(name, baseUrl, secretId) };
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
          tool_ids: toolIds,
        },
        first_message: "Hello, I'm your Pub Pal. What kind of night are you planning?",
        language: "en",
      },
      conversation: {
        max_duration_seconds: MAX_SESSION_SECONDS,
        client_events: clientEvents(),
      },
      ...(defaultVoice ? { tts: { voice_id: defaultVoice } } : {}),
    },
    platform_settings: {
      // Without this the agent id alone starts a conversation, and the agent id
      // is a query parameter in every signed URL the app hands out.
      auth: { enable_auth: true },
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: false },
            first_message: true,
          },
          tts: { voice_id: true },
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

async function findAgentByName(apiKey) {
  const listed = await call("GET", `${API}/agents?page_size=100`, apiKey);
  const rows = Array.isArray(listed.agents) ? listed.agents : [];
  const hit = rows.find((row) => row?.name === AGENT_NAME);
  return hit?.agent_id ?? null;
}

async function main() {
  loadDotEnv();

  const dryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const secret = process.env.ELEVENLABS_LLM_SHARED_SECRET?.trim();
  const baseUrl = (arg("base-url", process.env.PUBMAX_BASE_URL ?? "")).trim().replace(/\/+$/, "");

  if (!dryRun && !apiKey) fail("ELEVENLABS_API_KEY is not set. See docs/PUB_PAL_SETUP.md.");
  if (!secret) fail("ELEVENLABS_LLM_SHARED_SECRET is not set. Generate one: openssl rand -hex 32");
  if (!baseUrl) fail("Pass --base-url https://your-deployment (or set PUBMAX_BASE_URL).");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost/.test(baseUrl)) {
    fail(`--base-url must be https (or http://localhost for a tunnel test). Got: ${baseUrl}`);
  }

  const secretId = dryRun
    ? "dry-run-secret-locator"
    : await ensureWorkspaceLlmSecret(apiKey, secret);
  const toolIds = await ensureWebhookTools(apiKey, baseUrl, secretId, dryRun);
  const { body, defaultVoice } = agentBody(toolIds);

  if (dryRun) {
    console.log(
      "Dry run. This is the agent that would be written (secrets and tool ids held back):\n",
    );
    console.log(JSON.stringify(redactAgentPreview(body, baseUrl), null, 2));
    console.log("\nDefault voice resolved:", defaultVoice);
    console.log("\nLLM:", AGENT_CONFIG.llm, "-", AGENT_CONFIG.llmCreditNote);
    return;
  }

  const existing = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim() || (await findAgentByName(apiKey));

  if (existing) {
    const currentAgent = await call("GET", `${API}/agents/${existing}`, apiKey);
    const conversationConfig = structuredClone(currentAgent.conversation_config ?? {});
    conversationConfig.agent = {
      ...(conversationConfig.agent ?? {}),
      prompt: {
        ...(conversationConfig.agent?.prompt ?? {}),
        prompt: systemPrompt(),
        llm: AGENT_CONFIG.llm,
        custom_llm: null,
        tool_ids: toolIds,
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
    const patchBody = mergeAgentPatch(currentAgent, {
      ...body,
      conversation_config: conversationConfig,
    });
    await call("PATCH", `${API}/agents/${existing}`, apiKey, patchBody);
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
