import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "pubpal", "create-elevenlabs-agent.mjs");
const SECRET = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const BASE_URL = "https://pubmaxxing.com";
const AGENT_ID = "agent_check";
const SECRET_ID = "live-secret-id";

// Stands in for ElevenLabs. It serves the live agent and tools from a fixture
// file and records every call that is not a GET, which --check must never make.
const MOCK_FETCH = `
import { appendFileSync, readFileSync } from "node:fs";
const live = JSON.parse(readFileSync(process.env.PUBPAL_LIVE_FIXTURE, "utf8"));
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const text = String(url);
  const body = init.body ? JSON.parse(init.body) : {};
  if (method !== "GET") {
    // Record identities and settings only. Secret payloads never enter proof.
    const entry = { method, url: text, tool_ids: body.conversation_config?.agent?.prompt?.tool_ids,
      tool_config: body.tool_config ? { ...body.tool_config, api_schema: {
        ...body.tool_config.api_schema, request_headers: "redacted" } } : undefined };
    appendFileSync(process.env.PUBPAL_WRITES_LOG, JSON.stringify(entry) + "\\n");
    if (!live.allowWrites) return new Response("write refused", { status: 500 });
    if (text.includes("/convai/secrets")) return Response.json({ secret_id: "live-secret-id" });
    if (text.endsWith("/convai/tools")) return Response.json({ id: "created:" + body.tool_config.name });
    if (text.endsWith("/agents/create")) return Response.json({ agent_id: "agent_created" });
    return Response.json({});
  }
  if (text.includes("/agents?")) return Response.json({ agents: live.agent ? [live.agent] : [] });
  if (text.includes("/convai/agents/")) return Response.json(live.agent);
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

/** The agent exactly as the provisioner would write it, shaped as ElevenLabs reads it back. */
function matchingLive(baseUrl = BASE_URL): { agent: Json; tools: Json[]; secrets: Json[] } {
  const printed = run(["--dry-run", "--base-url", baseUrl]).stdout.split("\nDefault voice resolved:")[0] ?? "";
  const preview = JSON.parse(printed.slice(printed.indexOf("{"), printed.lastIndexOf("}") + 1)) as Json;
  const tools = (preview.webhook_tools as Json[]).map((config, index) => ({
    id: `tool_${index}`,
    tool_config: {
      ...config,
      api_schema: {
        ...config.api_schema,
        request_headers: { "x-elevenlabs-llm-secret": { secret_id: SECRET_ID } },
      },
    },
  }));
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

function check(live: { agent: Json; tools: Json[]; secrets: Json[]; allowWrites?: boolean; hasMore?: boolean }, update = false, baseUrl = BASE_URL) {
  const directory = scratch();
  writeFileSync(path.join(directory, "live.json"), JSON.stringify(live));
  writeFileSync(path.join(directory, "mock-fetch.mjs"), MOCK_FETCH);
  const writes = path.join(directory, "writes.log");
  writeFileSync(writes, "");
  const result = spawnSync(
    process.execPath,
    ["--import", path.join(directory, "mock-fetch.mjs"), SCRIPT, ...(update ? [] : ["--check"]), "--base-url", baseUrl],
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
  return { ...result, output: `${result.stdout}${result.stderr}`, writes: readFileSync(writes, "utf8") };
}

describe("pubpal:agent --check", () => {
  it.each([
    [BASE_URL, "https://pubpal-test.ngrok.app"],
    ["https://pubpal-test.ngrok.app", BASE_URL],
  ])("keeps attached webhook identities when changing base URL from %s to %s", (from, to) => {
    const live = matchingLive(from);
    const attachedTools = [...live.tools];
    const attachedIds = attachedTools.map((tool) => tool.id);
    live.tools.unshift(...matchingLive(to).tools.map((tool) => ({ ...tool, id: `unattached:${tool.id}` })));

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
    expect(created.map((row) => row.tool_config.api_schema.url)).toEqual(
      live.tools.map((tool) => `${to}/api/pub-pal/tools/${tool.tool_config.name}`),
    );
    expect(writes.find((row) => row.tool_ids)?.tool_ids).toEqual(
      live.tools.map((tool) => `created:${tool.tool_config.name}`),
    );
  });

  it("keeps the 16 captured attached webhook identities when client duplicates come first", () => {
    const live = matchingLive();
    const captured = JSON.parse(readFileSync(path.join(ROOT, "__tests__/fixtures/pubPalToolIdentity.json"), "utf8"));
    const byName = new Map(live.tools.map((tool) => [tool.tool_config.name, tool]));
    live.tools = captured.tools.flatMap((collision: Json) => {
      const tool = byName.get(collision.name) as Json;
      tool.id = collision.attached_matches[0].id;
      return [
        { id: collision.first_name_match.id, tool_config: { name: collision.name, type: "client" } },
        tool,
      ];
    });
    const attachedIds = captured.tools.map((collision: Json) => collision.attached_matches[0].id);
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
    const last = live.tools[live.tools.length - 1];
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
    const missing = live.tools.pop();
    live.agent.conversation_config.agent.prompt.tool_ids.pop();
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
    expect(writes.filter((row) => row.method === "POST" && row.url.endsWith("/tools"))).toHaveLength(16);
    expect(writes.find((row) => row.url.endsWith("/agents/create")).tool_ids).toHaveLength(16);
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
});
