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
  if (method !== "GET") {
    appendFileSync(process.env.PUBPAL_WRITES_LOG, method + " " + url + "\\n");
    return new Response("write refused", { status: 500 });
  }
  const text = String(url);
  if (text.includes("/convai/agents/")) return Response.json(live.agent);
  if (text.includes("/convai/tools")) return Response.json({ tools: live.tools });
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
function matchingLive(): { agent: Json; tools: Json[]; secrets: Json[] } {
  const printed = run(["--dry-run", "--base-url", BASE_URL]).stdout.split("\nDefault voice resolved:")[0] ?? "";
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

function check(live: { agent: Json; tools: Json[]; secrets: Json[] }) {
  const directory = scratch();
  writeFileSync(path.join(directory, "live.json"), JSON.stringify(live));
  writeFileSync(path.join(directory, "mock-fetch.mjs"), MOCK_FETCH);
  const writes = path.join(directory, "writes.log");
  writeFileSync(writes, "");
  const result = spawnSync(
    process.execPath,
    ["--import", path.join(directory, "mock-fetch.mjs"), SCRIPT, "--check", "--base-url", BASE_URL],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        ELEVENLABS_API_KEY: "test-key",
        ELEVENLABS_PUB_PAL_AGENT_ID: AGENT_ID,
        ELEVENLABS_LLM_SHARED_SECRET: "",
        PUBPAL_LIVE_FIXTURE: path.join(directory, "live.json"),
        PUBPAL_WRITES_LOG: writes,
      },
    },
  );
  return { ...result, output: `${result.stdout}${result.stderr}`, writes: readFileSync(writes, "utf8") };
}

describe("pubpal:agent --check", () => {
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
