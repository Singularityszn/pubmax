// Pure drift check for the Pub Pal ElevenLabs agent.
//
// `npm run pubpal:agent -- --check` reads the live agent and its tools, builds
// the same desired config the provisioner writes, and lists every field where
// the two differ. It compares only what a re-run writes, so a drift it names is
// one a re-run fixes. Nothing here calls the network or prints a secret.

const SECRET_HEADER = "x-elevenlabs-llm-secret";
const MAX_VALUE_LENGTH = 80;
const MAX_MISSING_PROMPT_LINES = 6;

function show(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const shown = text === undefined ? "missing" : text;
  return shown.length > MAX_VALUE_LENGTH ? `${shown.slice(0, MAX_VALUE_LENGTH)}...` : shown;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Every field the wanted object sets must be set the same way on the live
 * object. Live fields the wanted object never mentions are ignored. An array
 * named in `supersets` only has to contain the wanted entries, because a
 * provisioner PATCH keeps what the agent already sends.
 */
export function subsetDrift(wanted, live, path = "", supersets = new Set()) {
  if (isRecord(wanted)) {
    if (!isRecord(live)) return [{ path, wanted, live }];
    return Object.entries(wanted).flatMap(([key, value]) =>
      subsetDrift(value, live[key], path ? `${path}.${key}` : key, supersets),
    );
  }
  if (Array.isArray(wanted) && supersets.has(path)) {
    const have = Array.isArray(live) ? live : [];
    const missing = wanted.filter((item) => !have.includes(item));
    return missing.length > 0 ? [{ path, wanted: `includes ${missing.join(", ")}`, live }] : [];
  }
  return JSON.stringify(wanted) === JSON.stringify(live) ? [] : [{ path, wanted, live }];
}

function promptDrift(wantedPrompt, livePrompt) {
  if (wantedPrompt === livePrompt) return [];
  const liveLines = new Set(String(livePrompt ?? "").split("\n").map((line) => line.trim()));
  const missing = wantedPrompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !liveLines.has(line));
  const shown = missing.slice(0, MAX_MISSING_PROMPT_LINES).map((line) => `"${show(line)}"`);
  const more = missing.length > shown.length ? ` and ${missing.length - shown.length} more` : "";
  return [
    {
      path: "conversation_config.agent.prompt.prompt",
      wanted: missing.length > 0 ? `lines the live prompt lacks: ${shown.join(", ")}${more}` : "the house prompt",
      live: missing.length > 0 ? "an older prompt" : "a prompt with other wording or order",
    },
  ];
}

function toolDrift(name, wantedTool, liveTool) {
  if (!liveTool) return [{ path: `tools.${name}`, wanted: "a workspace webhook tool", live: "missing" }];
  const { request_headers: wantedHeaders, ...wantedSchema } = wantedTool.api_schema;
  void wantedHeaders;
  const found = subsetDrift(
    { ...wantedTool, api_schema: wantedSchema },
    liveTool.tool_config,
    `tools.${name}`,
  );
  const hasSecret = typeof liveTool.tool_config?.api_schema?.request_headers?.[SECRET_HEADER]?.secret_id === "string";
  if (!hasSecret) {
    found.push({ path: `tools.${name}.api_schema.request_headers.${SECRET_HEADER}`, wanted: "a secret id", live: "missing" });
  }
  return found;
}

/**
 * @param {object} input
 * @param {object} input.liveAgent The agent as GET /v1/convai/agents/{id} returns it.
 * @param {object[]} input.liveTools The workspace tools as GET /v1/convai/tools lists them.
 * @param {object} input.wantedAgent The agent body the provisioner would write.
 * @param {Record<string, object>} input.wantedTools The desired webhook tool config by name.
 * @returns {{path: string, wanted: unknown, live: unknown}[]}
 */
export function agentDrift({ liveAgent, liveTools, wantedAgent, wantedTools }) {
  const drifts = [];

  const wantedPrompt = wantedAgent.conversation_config.agent.prompt;
  const livePrompt = liveAgent.conversation_config?.agent?.prompt ?? {};
  drifts.push(...promptDrift(wantedPrompt.prompt, livePrompt.prompt));
  drifts.push(
    ...subsetDrift({ llm: wantedPrompt.llm }, livePrompt, "conversation_config.agent.prompt"),
  );

  // The provisioner keeps a live greeting and language, so they are not drift.
  drifts.push(
    ...subsetDrift(
      wantedAgent.conversation_config.conversation,
      liveAgent.conversation_config?.conversation,
      "conversation_config.conversation",
      new Set(["conversation_config.conversation.client_events"]),
    ),
  );
  drifts.push(
    ...subsetDrift(wantedAgent.platform_settings, liveAgent.platform_settings, "platform_settings"),
  );

  const liveToolIds = new Set(livePrompt.tool_ids ?? []);
  const wantedNames = new Set(Object.keys(wantedTools));
  for (const [name, wantedTool] of Object.entries(wantedTools)) {
    const liveTool = liveTools.find((row) => row?.tool_config?.name === name);
    drifts.push(...toolDrift(name, wantedTool, liveTool));
    if (liveTool && !liveToolIds.has(liveTool.id)) {
      drifts.push({ path: `tools.${name}`, wanted: "attached to the agent", live: "not attached" });
    }
  }
  for (const id of liveToolIds) {
    const row = liveTools.find((tool) => tool?.id === id);
    const name = row?.tool_config?.name;
    if (!name || !wantedNames.has(name)) {
      drifts.push({ path: `tools.${name ?? id}`, wanted: "not on the agent", live: "attached" });
    }
  }

  return drifts;
}

export function formatDrift(drift) {
  return `✗ ${drift.path}: live ${show(drift.live)}, wanted ${show(drift.wanted)}`;
}
