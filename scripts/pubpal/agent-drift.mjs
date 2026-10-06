// Pure drift check for the Pub Pal ElevenLabs agent.
//
// `npm run pubpal:agent -- --check` reads the live agent and its tools, builds
// the PATCH a run would send to that agent, and lists every field where the
// two differ. It compares only what a re-run writes, so a drift it names is
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
 * object. Live fields the wanted object never mentions are ignored.
 */
function subsetDrift(wanted, live, path = "") {
  if (isRecord(wanted)) {
    if (!isRecord(live)) return [{ path, wanted, live }];
    return Object.entries(wanted).flatMap(([key, value]) =>
      subsetDrift(value, live[key], path ? `${path}.${key}` : key),
    );
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
 * @param {object} input.wantedAgent The PATCH the provisioner would send to this live agent.
 * @param {Record<string, object>} input.wantedTools The desired webhook tool config by name.
 * @returns {{path: string, wanted: unknown, live: unknown}[]}
 */
export function agentDrift({ liveAgent, liveTools, wantedAgent, wantedTools }) {
  const drifts = [];

  // The prompt text gets a short summary and the tool ids are checked by name
  // below, so the rest of the PATCH is compared field by field.
  const wanted = structuredClone(wantedAgent);
  const wantedPrompt = wanted.conversation_config.agent.prompt;
  const livePrompt = liveAgent.conversation_config?.agent?.prompt ?? {};
  drifts.push(...promptDrift(wantedPrompt.prompt, livePrompt.prompt));
  delete wantedPrompt.prompt;
  delete wantedPrompt.tool_ids;
  drifts.push(...subsetDrift(wanted, liveAgent));

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
