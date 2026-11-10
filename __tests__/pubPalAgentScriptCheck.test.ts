import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { PAL_MAP_CLIENT_TOOLS } from "@/lib/palMapClientTools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "pubpal", "create-elevenlabs-agent.mjs");
const SECRET = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const BASE_URL = "https://pubmaxxing.com";
const AGENT_ID = "agent_check";
const SECRET_ID = "live-secret-id";
const WEBHOOKS = 16;
const TOOLS = WEBHOOKS + PAL_MAP_CLIENT_TOOLS.length;

// Stands in for ElevenLabs. It serves the live agent and tools from a fixture
// file and records every call that is not a GET, which --check must never make.
const MOCK_FETCH = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const live = JSON.parse(readFileSync(process.env.PUBPAL_LIVE_FIXTURE, "utf8"));
function merge(stored, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...stored };
  for (const [key, value] of Object.entries(patch)) result[key] = merge(stored?.[key], value);
  return result;
}
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const text = String(url);
  const body = init.body ? JSON.parse(init.body) : {};
  if (method !== "GET") {
    // Record identities and settings only. Secret payloads never enter proof.
    const entry = { method, url: text, tool_ids: body.conversation_config?.agent?.prompt?.tool_ids,
      agent_config: body.conversation_config ? { conversation_config: body.conversation_config, platform_settings: body.platform_settings } : undefined,
      tool_config: body.tool_config ? { ...body.tool_config, api_schema: {
        ...body.tool_config.api_schema, request_headers: "redacted" } } : undefined };
    appendFileSync(process.env.PUBPAL_WRITES_LOG, JSON.stringify(entry) + "\\n");
    if (!live.allowWrites) return new Response("write refused", { status: 500 });
    if (method === "PATCH" && text.includes("/convai/agents/")) {
      const updated = merge(live.agent, body);
      const prompt = updated.conversation_config.agent.prompt;
      if (live.reasoningContract && prompt.llm === live.reasoningContract.llm && prompt.reasoning_effort !== live.reasoningContract.reasoning_effort) {
        return Response.json({ detail: { code: "invalid_parameters", field: "agent.prompt", message: "Reasoning effort is not supported for this LLM" } }, { status: 400 });
      }
      live.agent = updated;
      writeFileSync(process.env.PUBPAL_LIVE_FIXTURE, JSON.stringify(live));
      return Response.json(updated);
    }
    if (text.includes("/convai/secrets")) return Response.json({ secret_id: "live-secret-id" });
    if (text.endsWith("/convai/tools")) return Response.json({ id: "created:" + body.tool_config.name });
    if (text.endsWith("/agents/create")) return Response.json({ agent_id: "agent_created" });
    return Response.json({});
  }
  if (text.includes("/agents?")) return Response.json({ agents: live.agent ? [live.agent] : [] });
  if (text.includes("/convai/agents/")) return Response.json(text.includes("branch_id=") || !live.mainAgent ? live.agent : live.mainAgent);
  if (text.includes("/convai/tools")) return Response.json({ tools: live.tools, has_more: live.hasMore ?? false });
  if (text.includes("/convai/secrets")) return Response.json({ secrets: live.secrets });
  return new Response("unexpected " + text, { status: 404 });
};
`;

// The ElevenLabs agent JSON, read and edited by path in these fixtures.
type Json = ReturnType<typeof JSON.parse>;

const directories: string[] = [];

function scratch() {
  const directory = mkdtempSync(path.join(tmpdir(), "pubmax-pubpal-check-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}, cwd = scratch()) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ELEVENLABS_LLM_SHARED_SECRET: SECRET,
      ELEVENLABS_API_KEY: "",
      ELEVENLABS_PUB_PAL_AGENT_ID: "",
      ...env,
    },
  });
}

const webhooks = (tools: Json[]) => tools.filter((tool) => tool.tool_config.type === "webhook");

/** The live fixture read through a branch, as the provider names one. */
function onBranch<T extends { agent: Json }>(live: T, branch = "agtbranch_test"): T {
  live.agent.branch_id = branch;
  live.agent.main_branch_id = "agtbranch_main";
  return live;
}

/** The agent exactly as the provisioner would write it, shaped as ElevenLabs reads it back. */
function matchingLive(baseUrl = BASE_URL): { agent: Json; tools: Json[]; secrets: Json[] } {
  const printed = run(["--dry-run", "--base-url", baseUrl]).stdout.split("\nDefault voice resolved:")[0] ?? "";
  const preview = JSON.parse(printed.slice(printed.indexOf("{"), printed.lastIndexOf("}") + 1)) as Json;
  const tools = [...(preview.webhook_tools as Json[]).map((config, index) => ({
    id: `tool_${index}`,
    tool_config: {
      ...config,
      api_schema: {
        ...config.api_schema,
        request_headers: { "x-elevenlabs-llm-secret": { secret_id: SECRET_ID } },
      },
    },
  })), ...(preview.client_tools as Json[]).map((config, index) => ({ id: `client_${index}`, tool_config: config }))];
  const agent = {
    agent_id: AGENT_ID,
    name: preview.name,
    conversation_config: {
      ...preview.conversation_config,
      agent: {
        ...preview.conversation_config.agent,
        prompt: { ...preview.conversation_config.agent.prompt, tool_ids: tools.map((tool) => tool.id) },
      },
    },
    platform_settings: preview.platform_settings,
  };
  const secrets = [{ secret_id: SECRET_ID, name: "PUBMAXX_PUB_PAL_LLM_SECRET" }];
  return { agent, tools, secrets };
}

function check(live: { agent: Json; mainAgent?: Json; tools: Json[]; secrets: Json[]; allowWrites?: boolean; hasMore?: boolean;
  reasoningContract?: { llm: "gemini-2.5-flash-lite"; reasoning_effort: null } }, update = false, baseUrl = BASE_URL, extra: string[] = []) {
  const directory = scratch();
  writeFileSync(path.join(directory, "live.json"), JSON.stringify(live));
  writeFileSync(path.join(directory, "mock-fetch.mjs"), MOCK_FETCH);
  const writes = path.join(directory, "writes.log");
  writeFileSync(writes, "");
  const result = spawnSync(
    process.execPath,
    ["--import", path.join(directory, "mock-fetch.mjs"), SCRIPT, ...(update ? [] : ["--check"]), "--base-url", baseUrl, ...extra],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        ELEVENLABS_API_KEY: "test-key",
        ELEVENLABS_PUB_PAL_AGENT_ID: live.agent ? AGENT_ID : "",
        ELEVENLABS_LLM_SHARED_SECRET: update ? SECRET : "",
        PUBPAL_LIVE_FIXTURE: path.join(directory, "live.json"),
        PUBPAL_WRITES_LOG: writes,
      },
    },
  );
  return { ...result, output: `${result.stdout}${result.stderr}`, writes: readFileSync(writes, "utf8"), live: JSON.parse(readFileSync(path.join(directory, "live.json"), "utf8")) };
}

describe("pubpal:agent --check", () => {
  it("clears model-specific reasoning through the executable update and read-only check", () => {
    const live = matchingLive();
    const toolIds = [...live.agent.conversation_config.agent.prompt.tool_ids];
    live.agent.conversation_config.agent.prompt.llm = "gemini-3.1-flash-lite";
    live.agent.conversation_config.agent.prompt.reasoning_effort = "minimal";
    live.agent.conversation_config.agent.first_message = "Existing greeting";
    live.agent.conversation_config.agent.language = "en";
    live.agent.conversation_config.tts = { voice_id: "existing-voice" };
    live.agent.platform_settings.overrides.conversation_config_override.tts.speed = true;
    const contract = { llm: "gemini-2.5-flash-lite", reasoning_effort: null } as const;
    const drift = check({ ...live, reasoningContract: contract });
    expect(drift.status).toBe(1);
    expect(drift.writes).toBe("");
    const updated = check({ ...live, allowWrites: true, reasoningContract: contract }, true);
    expect(updated.status, updated.output).toBe(0);
    expect(drift.output).toContain("conversation_config.agent.prompt.reasoning_effort");
    expect(updated.live.agent.conversation_config.agent.prompt).toMatchObject({ ...contract, tool_ids: toolIds });
    expect(toolIds).toHaveLength(TOOLS);
    expect(updated.live.agent.conversation_config.agent).toMatchObject({ first_message: "Existing greeting", language: "en" });
    expect(updated.live.agent.conversation_config.tts).toEqual({ voice_id: "existing-voice" });
    expect(updated.live.agent.conversation_config.conversation.max_duration_seconds).toBe(180);
    expect(updated.live.agent.platform_settings.auth).toEqual({ enable_auth: true, allowlist: [] });
    expect(updated.live.agent.platform_settings.privacy).toEqual({ record_voice: false, retention_days: -1, delete_transcript_and_pii: true, zero_retention_mode: true });
    expect(updated.live.agent.platform_settings.overrides.conversation_config_override).toEqual({ agent: { prompt: { prompt: false }, first_message: true }, tts: { voice_id: true, speed: true }, conversation: { text_only: true } });
    const receipt = check(updated.live);
    expect(receipt.status, receipt.output).toBe(0);
    expect(receipt.writes).toBe("");
    updated.live.agent.platform_settings.privacy.delete_transcript_and_pii = false;
    const privacyDrift = check(updated.live);
    expect(privacyDrift.status).toBe(1);
    expect(privacyDrift.output).toContain("platform_settings.privacy.delete_transcript_and_pii");
    expect(privacyDrift.writes).toBe("");
  });

  it("reports an agent still on the provider's turn-taking defaults and lays the listening settings over it", () => {
    const live = matchingLive();
    // An agent provisioned before the listening settings: provider defaults,
    // plus a dashboard-only turn setting the update must keep.
    live.agent.conversation_config.turn = { turn_eagerness: "normal", turn_timeout: 7 };
    live.agent.conversation_config.asr = { quality: "high", provider: "scribe_realtime", user_input_audio_format: "pcm_16000" };
    const drift = check(live);
    expect(drift.status).toBe(1);
    expect(drift.writes).toBe("");
    expect(drift.output).toContain("conversation_config.turn.turn_eagerness: live normal, wanted patient");
    expect(drift.output).toContain("conversation_config.turn.transcribe_on_disabled_interruptions");
    expect(drift.output).toContain("conversation_config.asr.keywords");

    const updated = check({ ...live, allowWrites: true }, true);
    expect(updated.status, updated.output).toBe(0);
    expect(updated.live.agent.conversation_config.turn).toEqual({
      turn_eagerness: "patient",
      turn_timeout: 7,
      transcribe_on_disabled_interruptions: true,
      silence_end_call_timeout: 20,
    });
    expect(updated.live.agent.conversation_config.asr).toMatchObject({
      quality: "high",
      provider: "scribe_realtime",
      user_input_audio_format: "pcm_16000",
    });
    expect(updated.live.agent.conversation_config.asr.keywords).toContain("Wetherspoons");
    const receipt = check(updated.live);
    expect(receipt.status, receipt.output).toBe(0);
  });

  it.each([
    [BASE_URL, "https://pubpal-test.ngrok.app"],
    ["https://pubpal-test.ngrok.app", BASE_URL],
  ])("keeps attached webhook identities when changing base URL from %s to %s", (from, to) => {
    const live = matchingLive(from);
    const attachedTools = webhooks(live.tools);
    const attachedIds = live.tools.map((tool) => tool.id);
    live.tools.unshift(...webhooks(matchingLive(to).tools).map((tool) => ({ ...tool, id: `unattached:${tool.id}` })));

    const checked = check(live, false, to);
    expect(checked.status).toBe(1);
    expect(checked.output).toContain(`Checked agent ${AGENT_ID}`);
    expect(checked.writes).toBe("");
    for (const tool of attachedTools) {
      expect(checked.output).toContain(`tools.${tool.tool_config.name}.api_schema.url: live ${from}/api/pub-pal/tools/${tool.tool_config.name}, wanted ${to}/api/pub-pal/tools/${tool.tool_config.name}`);
    }

    const updated = check({ ...live, allowWrites: true }, true, to);
    expect(updated.status).toBe(0);
    const writes = updated.writes.trim().split("\n").map((line) => JSON.parse(line));
    const patches = writes.filter((row) => row.method === "PATCH" && row.url.includes("/tools/"));
    expect(patches.map((row) => row.url.split("/").pop())).toEqual(attachedIds);
    patches.splice(WEBHOOKS);
    expect(writes.find((row) => row.tool_ids)?.tool_ids).toEqual(attachedIds);
    expect(writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"))).toHaveLength(0);
    for (const [index, tool] of attachedTools.entries()) {
      expect(patches[index].tool_config.api_schema.url).toBe(`${to}/api/pub-pal/tools/${tool.tool_config.name}`);
      tool.tool_config.api_schema.url = patches[index].tool_config.api_schema.url;
    }
    const rechecked = check(live, false, to);
    expect(rechecked.status).toBe(0);
    expect(rechecked.output).toContain("The live agent matches");
    expect(rechecked.writes).toBe("");
  });

  it.each([
    [BASE_URL, "https://pubpal-test.ngrok.app"],
    ["https://pubpal-test.ngrok.app", BASE_URL],
  ])("does not reuse unattached webhooks when changing base URL from %s to %s", (from, to) => {
    const live = matchingLive(from);
    live.agent.conversation_config.agent.prompt.tool_ids = [];
    live.tools = webhooks(live.tools);
    const checked = check(live, false, to);
    expect(checked.status).toBe(1);
    expect(checked.writes).toBe("");
    for (const tool of live.tools) {
      expect(checked.output).toContain(`tools.${tool.tool_config.name}: live missing`);
    }
    const updated = check({ ...live, allowWrites: true }, true, to);
    expect(updated.status).toBe(0);
    const writes = updated.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(writes.filter((row) => row.method === "PATCH" && row.url.includes("/tools/"))).toHaveLength(0);
    const created = writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"));
    expect(created.slice(0, WEBHOOKS).map((row) => row.tool_config.api_schema.url)).toEqual(
      live.tools.map((tool) => `${to}/api/pub-pal/tools/${tool.tool_config.name}`),
    );
    expect(writes.find((row) => row.tool_ids)?.tool_ids).toEqual(
      [...live.tools.map((tool) => tool.tool_config.name), ...PAL_MAP_CLIENT_TOOLS.map((tool) => tool.name)]
        .map((name) => `created:${name}`),
    );
  });

  it("keeps the 16 captured attached webhook identities when client duplicates come first", () => {
    const live = matchingLive();
    const captured = JSON.parse(readFileSync(path.join(ROOT, "__tests__/fixtures/pubPalToolIdentity.json"), "utf8"));
    const byName = new Map(live.tools.map((tool) => [tool.tool_config.name, tool]));
    const clients = live.tools.filter((tool) => tool.tool_config.type === "client");
    live.tools = captured.tools.flatMap((collision: Json) => {
      const tool = byName.get(collision.name) as Json;
      tool.id = collision.attached_matches[0].id;
      return [
        { id: collision.first_name_match.id, tool_config: { name: collision.name, type: "client" } },
        tool,
      ];
    });
    live.tools.push(...clients);
    const attachedIds = [...captured.tools.map((collision: Json) => collision.attached_matches[0].id), ...clients.map((tool) => tool.id)];
    live.agent.conversation_config.agent.prompt.tool_ids = attachedIds;
    const checked = check(live);
    const updated = check({ ...live, allowWrites: true }, true);
    const writes = updated.writes.trim().split("\n").map((line) => JSON.parse(line));
    const patchedIds = writes.filter((row) => row.method === "PATCH" && row.url.includes("/tools/"))
      .map((row) => row.url.split("/").pop());
    const plannedIds = writes.find((row) => row.tool_ids)?.tool_ids;
    const proof = { checked: { status: checked.status, output: checked.output, writes: checked.writes },
      updated: { status: updated.status, output: updated.output, patchedIds, plannedIds }, attachedIds };
    console.log("Captured identity CLI result:", JSON.stringify(proof));
    expect(checked.status).toBe(0);
    expect(updated.status).toBe(0);
    expect(patchedIds).toEqual(attachedIds);
    expect(plannedIds).toEqual(attachedIds);
  });

  it("refuses an unknown attached identity before any update", () => {
    const live = matchingLive();
    live.agent.conversation_config.agent.prompt.tool_ids.push("tool_not_listed");
    const result = check({ ...live, allowWrites: true }, true);
    expect(result.output).toContain("Attached tool tool_not_listed is absent from the workspace tool list");
    expect(result.status).toBe(1);
    expect(result.writes).toBe("");
  });

  it.each([false, true])("keeps attached webhooks when duplicate order is reversed: %s", (reverse) => {
    const live = matchingLive();
    const first = live.tools[0];
    const duplicate = { ...first, id: "unattached_webhook" };
    const client = { id: "unattached_client", tool_config: { name: first.tool_config.name, type: "client" } };
    live.tools = reverse ? [...live.tools, client, duplicate] : [client, duplicate, ...live.tools];
    const checked = check(live);
    const updated = check({ ...live, allowWrites: true }, true);
    expect(checked.status).toBe(0);
    expect(checked.writes).toBe("");
    expect(updated.status).toBe(0);
    expect(updated.writes).not.toContain("unattached_webhook");
    expect(updated.writes).not.toContain("unattached_client");
  });

  it.each([false, true])("refuses ambiguous identities before a partial update, attached: %s", (attached) => {
    const live = matchingLive();
    const last = webhooks(live.tools).at(-1);
    const duplicate = { ...last, id: "ambiguous_last", tool_config: structuredClone(last.tool_config) };
    live.tools.push(duplicate);
    const ids = live.agent.conversation_config.agent.prompt.tool_ids;
    if (attached) {
      duplicate.tool_config.api_schema.url = `https://pubpal-test.ngrok.app/api/pub-pal/tools/${last.tool_config.name}`;
      ids.push(duplicate.id);
    } else live.agent.conversation_config.agent.prompt.tool_ids = ids.filter((id: string) => id !== last.id);
    for (const update of [false, true]) {
      const result = check({ ...live, allowWrites: true }, update);
      expect(result.status).toBe(1);
      expect(result.output).toContain(`Ambiguous tool ${last.tool_config.name}: 2`);
      expect(result.output).toContain(last.id);
      expect(result.output).toContain(duplicate.id);
      expect(result.writes).toBe("");
    }
  });

  it("refuses an attached tool with an incompatible type", () => {
    const live = matchingLive();
    const first = live.tools[0];
    live.tools.unshift({ ...first, id: "compatible_unattached", tool_config: structuredClone(first.tool_config) });
    first.tool_config.type = "client";
    for (const update of [false, true]) {
      const result = check({ ...live, allowWrites: true }, update);
      expect(result.status).toBe(1);
      expect(result.output).toContain(`Attached tool search_venues (${first.id}) does not match`);
      expect(result.output).toContain("requested webhook type");
      expect(result.writes).toBe("");
    }
  });

  it("reuses a unique compatible workspace webhook and still updates its speech settings", () => {
    const live = matchingLive();
    const first = live.tools[0];
    first.tool_config.pre_tool_speech = "auto";
    live.agent.conversation_config.agent.prompt.tool_ids.shift();
    live.tools.unshift({ id: "unrelated_client", tool_config: { name: first.tool_config.name, type: "client" } });
    const checked = check(live);
    expect(checked.status).toBe(1);
    expect(checked.output).toContain("pre_tool_speech: live auto, wanted force");
    expect(checked.output).toContain("live not attached");
    const result = check({ ...live, allowWrites: true }, true);
    expect(result.status).toBe(0);
    const writes = result.writes.trim().split("\n").map((line) => JSON.parse(line));
    const patched = writes.find((row) => row.url.endsWith(`/tools/${first.id}`));
    expect(patched.tool_config).toMatchObject({ type: "webhook", pre_tool_speech: "force", response_timeout_secs: 28 });
    expect(writes.find((row) => row.tool_ids).tool_ids).toContain(first.id);
    expect(result.writes).not.toContain("unrelated_client");
  });

  it("creates a missing webhook without changing an unrelated same-name client or endpoint", () => {
    const live = matchingLive();
    const [missing] = live.tools.splice(WEBHOOKS - 1, 1);
    live.agent.conversation_config.agent.prompt.tool_ids.splice(WEBHOOKS - 1, 1);
    live.tools.push({ id: "unrelated_client", tool_config: { name: missing.tool_config.name, type: "client" } });
    live.tools.push({ ...missing, id: "unrelated_endpoint", tool_config: {
      ...missing.tool_config, api_schema: { ...missing.tool_config.api_schema, url: "https://elsewhere.example/tool" } } });
    const checked = check(live);
    expect(checked.status).toBe(1);
    expect(checked.output).toContain(`tools.${missing.tool_config.name}: live missing`);
    expect(checked.writes).toBe("");
    const updated = check({ ...live, allowWrites: true }, true);
    const writes = updated.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(updated.status).toBe(0);
    expect(writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"))).toHaveLength(1);
    expect(writes.find((row) => row.tool_ids).tool_ids).toContain(`created:${missing.tool_config.name}`);
    expect(updated.writes).not.toContain("unrelated_client");
    expect(updated.writes).not.toContain("unrelated_endpoint");
  });

  it("creates tools and the agent when neither exists", () => {
    const live = matchingLive();
    live.agent = null;
    live.tools = [];
    live.secrets = [];
    const result = check({ ...live, allowWrites: true }, true);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Created agent agent_created");
    const writes = result.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"))).toHaveLength(TOOLS);
    expect(writes.find((row) => row.url.endsWith("/agents/create")).tool_ids).toHaveLength(TOOLS);
    expect(writes.find((row) => row.url.endsWith("/agents/create")).agent_config.conversation_config.agent.prompt).toMatchObject({ llm: "gemini-2.5-flash-lite", reasoning_effort: null });
    expect(result.output).not.toContain(SECRET);
    expect(result.writes).not.toContain(SECRET);
  });

  it("refuses an incomplete workspace list before any update", () => {
    const live = matchingLive();
    for (const update of [false, true]) {
      const result = check({ ...live, hasMore: true, allowWrites: true }, update);
      expect(result.status).toBe(1);
      expect(result.output).toContain("Workspace tool list is incomplete");
      expect(result.writes).toBe("");
    }
  });

  it("exits 0 when the live agent matches what a run would write", () => {
    const result = check(matchingLive());
    expect(result.output).toContain("The live agent matches");
    expect(result.status).toBe(0);
  });

  it("makes no write call and needs no shared secret", () => {
    const result = check(matchingLive());
    expect(result.writes).toBe("");
    expect(result.output).not.toContain("ELEVENLABS_LLM_SHARED_SECRET");
  });

  it("ignores the fields a run leaves out of its PATCH", () => {
    const live = matchingLive();
    const prompt = live.agent.conversation_config.agent.prompt;
    prompt.custom_llm = { url: "https://llm.example/v1", model_id: "old-model" };
    prompt.tools = live.tools.map((tool: Json) => tool.tool_config);
    const result = check(live);
    expect(result.output).toContain("The live agent matches");
    expect(result.status).toBe(0);
  });

  it("exits 1 on a field the run rewrites that a hand-written list would miss", () => {
    const live = matchingLive();
    live.agent.name = "Renamed Pal";
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("name: live Renamed Pal, wanted PUBMAXX Pub Pal");
  });

  it("exits 1 and names an agent that accepts unsigned conversations", () => {
    const live = matchingLive();
    live.agent.platform_settings.auth = { enable_auth: false, allowlist: [] };
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("platform_settings.auth.enable_auth: live false, wanted true");
  });

  it("exits 1 and names a missing tool, a speech setting and a client event that drifted", () => {
    const live = matchingLive();
    const missing = live.tools.findIndex((tool) => tool.tool_config.name === "recall_memories");
    live.tools.splice(missing, 1);
    live.agent.conversation_config.agent.prompt.tool_ids = live.tools.map((tool) => tool.id);
    const first = live.tools[0] as Json;
    first.tool_config.pre_tool_speech = "auto";
    live.agent.conversation_config.conversation.client_events = ["audio", "agent_response"];
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("tools.recall_memories: live missing");
    expect(result.output).toContain(`tools.${first.tool_config.name}.pre_tool_speech: live auto, wanted force`);
    expect(result.output).toContain("conversation_config.conversation.client_events");
  });

  it("exits 1 when the prompt lost a rule, without printing the whole prompt", () => {
    const live = matchingLive();
    const prompt: string = live.agent.conversation_config.agent.prompt.prompt;
    live.agent.conversation_config.agent.prompt.prompt = prompt.split("\n").slice(0, 3).join("\n");
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("conversation_config.agent.prompt.prompt");
    expect(result.output).not.toContain(prompt);
  });

  it("exits 1 when a tool the config does not name is attached to the agent", () => {
    const live = matchingLive();
    const first = live.tools[0] as Json;
    live.tools.push({ id: "tool_extra", tool_config: { ...first.tool_config, name: "stray_tool" } });
    live.agent.conversation_config.agent.prompt.tool_ids.push("tool_extra");
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("tools.stray_tool: live attached, wanted not on the agent");
  });

  it("exits 1 when an agent still holds a hostname allowlist beside signed-URL auth", () => {
    const live = matchingLive();
    live.agent.platform_settings.auth = { enable_auth: true, allowlist: [{ hostname: "example.com" }] };
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("platform_settings.auth.allowlist");
  });

  it("exits 1 when a tool names a different workspace secret, without printing either id", () => {
    const live = matchingLive();
    const first = live.tools[0] as Json;
    first.tool_config.api_schema.request_headers["x-elevenlabs-llm-secret"].secret_id = "someone-elses-secret";
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`tools.${first.tool_config.name}.api_schema.request_headers.x-elevenlabs-llm-secret: live a different secret`);
    expect(result.output).not.toContain("someone-elses-secret");
    expect(result.output).not.toContain(SECRET_ID);
  });

  it("exits 1 when the workspace secret itself is missing", () => {
    const live = matchingLive();
    live.secrets = [];
    const result = check(live);
    expect(result.status).toBe(1);
    expect(result.output).toContain("secrets.PUBMAXX_PUB_PAL_LLM_SECRET: live missing");
  });

  it("names a map client tool missing from the agent, then creates and attaches it", () => {
    const live = matchingLive();
    const focus = live.tools.find((tool) => tool.tool_config.name === "map_focus_pick")!;
    live.tools = live.tools.filter((tool) => tool !== focus);
    live.agent.conversation_config.agent.prompt.tool_ids = live.tools.map((tool) => tool.id);
    const checked = check(live);
    expect(checked.status).toBe(1);
    expect(checked.output).toContain("tools.map_focus_pick: live missing, wanted a workspace client tool");
    const updated = check({ ...live, allowWrites: true }, true);
    expect(updated.status, updated.output).toBe(0);
    const writes = updated.writes.trim().split("\n").map((line) => JSON.parse(line));
    const created = writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"));
    expect(created.map((row) => row.tool_config)).toEqual([expect.objectContaining({
      type: "client", name: "map_focus_pick", expects_response: false,
    })]);
    expect(writes.find((row) => row.tool_ids).tool_ids).toContain("created:map_focus_pick");
  });

  it("reads and writes only the named branch, never Main", () => {
    const live = matchingLive();
    live.agent.conversation_config.turn = { turn_eagerness: "patient", transcribe_on_disabled_interruptions: true };
    const checked = check(live, false, BASE_URL, ["--branch-id", "agtbranch_test"]);
    expect(checked.status).toBe(1);
    expect(checked.output).toContain(`Checked agent ${AGENT_ID} branch agtbranch_test`);
    expect(checked.output).toContain("conversation_config.turn.silence_end_call_timeout: live missing, wanted 20");
    const updated = check({ ...onBranch(live), allowWrites: true }, true, BASE_URL, ["--branch-id", "agtbranch_test"]);
    expect(updated.status, updated.output).toBe(0);
    // Every tool already matches and the secret is shared with Main, so the branch is the only write.
    const writes = updated.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(writes.map((row) => `${row.method} ${row.url}`)).toEqual([
      `PATCH https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}?branch_id=agtbranch_test`,
    ]);
    expect(check(live, false, BASE_URL, ["--branch-id", "../main"]).output).toContain("--branch-id is not a branch id");
  });

  it("gives a branch at another URL its own webhooks and leaves Main's tools and the secret alone", () => {
    const live = matchingLive();
    const tunnel = "https://pubpal-test.ngrok.app";
    const result = check({ ...onBranch(live), allowWrites: true }, true, tunnel, ["--branch-id", "agtbranch_test"]);
    expect(result.status, result.output).toBe(0);
    const writes = result.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(writes.filter((row) => row.url.includes("/tools/") || row.url.includes("/secrets"))).toEqual([]);
    const created = writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"));
    expect(created.map((row) => row.tool_config.api_schema.url)).toEqual(
      webhooks(live.tools).map((tool) => `${tunnel}/api/pub-pal/tools/${tool.tool_config.name}`),
    );
    const branch = writes.find((row) => row.tool_ids);
    expect(branch.url).toContain("?branch_id=agtbranch_test");
    expect(branch.tool_ids).toEqual([
      ...webhooks(live.tools).map((tool) => `created:${tool.tool_config.name}`),
      ...live.tools.filter((tool) => tool.tool_config.type === "client").map((tool) => tool.id),
    ]);
  });

  it("refuses a branch change to a tool Main has attached, before any write", () => {
    const live = matchingLive();
    live.tools[0].tool_config.description = "An older description.";
    const result = check({ ...onBranch(live), allowWrites: true }, true, BASE_URL, ["--branch-id", "agtbranch_test"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`Tool ${live.tools[0].tool_config.name} (${live.tools[0].id}) is attached to Main`);
    expect(result.writes).toBe("");
  });

  it("changes a tool only the branch has attached", () => {
    const live = matchingLive();
    const focus = live.tools.find((tool) => tool.tool_config.name === "map_focus_pick")!;
    focus.tool_config.description = "An older description.";
    const mainAgent = structuredClone(live.agent);
    mainAgent.conversation_config.agent.prompt.tool_ids = mainAgent.conversation_config.agent.prompt.tool_ids
      .filter((id: string) => id !== focus.id);
    const result = check({ ...onBranch(live), mainAgent, allowWrites: true }, true, BASE_URL, ["--branch-id", "agtbranch_test"]);
    expect(result.status, result.output).toBe(0);
    const writes = result.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(writes.filter((row) => row.url.includes("/tools")).map((row) => `${row.method} ${row.url.split("/").pop()}`))
      .toEqual([`PATCH ${focus.id}`]);
  });

  it("never adopts an unattached client tool of the same name, which may be another agent's", () => {
    const live = matchingLive();
    const open = live.tools.find((tool) => tool.tool_config.name === "map_open")!;
    live.agent.conversation_config.agent.prompt.tool_ids = live.agent.conversation_config.agent.prompt.tool_ids
      .filter((id: string) => id !== open.id);
    const result = check({ ...live, allowWrites: true }, true);
    expect(result.status, result.output).toBe(0);
    const writes = result.writes.trim().split("\n").map((line) => JSON.parse(line));
    expect(result.writes).not.toContain(`/tools/${open.id}`);
    expect(writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools")).map((row) => row.tool_config.name))
      .toEqual(["map_open"]);
  });

  it.each([
    ["Main's own branch", "agtbranch_main", "agtbranch_main"],
    ["a branch the provider does not name", "agtbranch_other", "agtbranch_main"],
  ])("refuses --branch-id for %s before any write", (_, liveBranch, mainBranch) => {
    const live = matchingLive();
    live.agent.branch_id = liveBranch;
    live.agent.main_branch_id = mainBranch;
    const requested = liveBranch === mainBranch ? liveBranch : "agtbranch_test";
    const result = check({ ...live, allowWrites: true }, true, "https://pubpal-test.ngrok.app", ["--branch-id", requested]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`--branch-id ${requested} is not a branch other than Main of this agent`);
    expect(result.writes).toBe("");
  });
});
