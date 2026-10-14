import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/pubpal/create-elevenlabs-agent.mjs");
const scratchRoot = path.join(ROOT, "artifacts/test-fix-r5/privacy");
const directories: string[] = [];
type Json = ReturnType<typeof JSON.parse>;

function currentAgent(): Json {
  return {
    agent_id: "agent_synthetic", branch_id: "branch_synthetic", main_branch_id: "branch_synthetic",
    metadata: { created_at_unix_secs: 1 }, name: "Synthetic private agent", tags: ["second", "first"],
    conversation_config: {
      agent: { first_message: "Existing greeting", language: "en", prompt: {
        prompt: "Ordinary prompt with the word redacted, unchanged.", llm: "gemini-3.1-flash-lite",
        reasoning_effort: null, temperature: 0, tool_ids: ["tool_b", "tool_a"],
        custom_llm: { url: "https://synthetic.example/v1", api_key: { secret_id: "synthetic-secret" },
          auth_connection: { auth_connection_id: "synthetic-auth" },
          request_headers: { Authorization: { env_var_label: "SYNTHETIC_AUTH" }, "Content-Type": "application/json" } },
      } },
      conversation: { client_events: ["audio", "agent_response"], max_duration_seconds: 123, text_only: false },
      tts: { voice_id: "synthetic-voice", stability: 0, speed: 1 },
    },
    platform_settings: {
      auth: { enable_auth: true, allowlist: [], shareable_token: null },
      privacy: { record_voice: false, retention_days: -1, delete_transcript_and_pii: false, zero_retention_mode: true },
      overrides: { conversation_config_override: { tts: { voice_id: true, speed: false }, agent: { prompt: { prompt: false } } } },
      call_limits: { agent_concurrency_limit: 0, daily_limit: 0, bursting_enabled: false },
      safety: { ignore_safety_evaluation: false, is_blocked_ivc: false, is_blocked_non_ivc: false },
    },
    workflow: { nodes: { start: { type: "start", position: { x: 0, y: 0 }, edge_order: [] } }, edges: {}, prevent_subagent_loops: false },
    procedures: { procedure_synthetic: { procedure_id: "procedure_synthetic", version_id: "version_synthetic", name: "Existing procedure" } },
  };
}

const MOCK = `
import { appendFileSync, readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(process.env.PRIVACY_FIXTURE, 'utf8'));
let gets = 0;
globalThis.fetch = async (url, init = {}) => {
 const method = init.method ?? 'GET';
 appendFileSync(process.env.PRIVACY_CALLS, JSON.stringify({url: String(url), method, body: init.body}) + '\\n');
 if (!String(url).endsWith('/agents/agent_synthetic?branch_id=branch_synthetic')) throw Error('Unexpected endpoint');
 if ((gets === 1 && method === "GET" && fixture.postNetworkFailure) || fixture.networkFailure === method) throw Error('Synthetic failure with secret response text');
 if ((gets === 1 && method === "GET" && fixture.postHttpFailure) || fixture.httpFailure === method) return new Response('Synthetic private provider detail', {status: 400});
 if (method === 'GET') {
  gets++;
  const value = structuredClone(fixture.agent);
  if (gets === 2) {
   value.platform_settings.privacy.delete_transcript_and_pii = true;
   if (fixture.drift) value.conversation_config.agent.first_message = 'drift';
   if (fixture.postIdentity) value.main_branch_id = 'other';
   if (fixture.noEffect) value.platform_settings.privacy.delete_transcript_and_pii = false;
  }
  return Response.json(value);
 }
 if (method === 'PATCH') return Response.json({});
 throw Error('Unexpected method');
};
`;

function run(agent = currentAgent(), options: Json = {}) {
  mkdirSync(scratchRoot, { recursive: true });
  const dir = mkdtempSync(path.join(scratchRoot, "case-"));
  directories.push(dir);
  const attest = { agent_id: "agent_synthetic", branch_id: "branch_synthetic", target_is_main: true,
    whole_agent_traffic_isolated: true, executing_binding_verified: true, remote_exclusive_writer_verified: true,
    live_operation_approved: true, ...options.attestation };
  writeFileSync(path.join(dir, "attestation.json"), JSON.stringify(attest));
  writeFileSync(path.join(dir, "fixture.json"), JSON.stringify({ agent, ...options }));
  writeFileSync(path.join(dir, "mock.mjs"), MOCK);
  writeFileSync(path.join(dir, "calls.jsonl"), "");
  const result = spawnSync(process.execPath, ["--import", path.join(dir, "mock.mjs"), SCRIPT,
    "--privacy-delete-only", "--agent-id", "agent_synthetic", "--branch-id", "branch_synthetic",
    "--privacy-attestation", path.join(dir, "attestation.json"), ...(options.extraArgs ?? [])], {
    cwd: dir, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, ELEVENLABS_API_KEY: "synthetic-key", ELEVENLABS_LLM_SHARED_SECRET: "",
      ELEVENLABS_PUB_PAL_AGENT_ID: "", PRIVACY_FIXTURE: path.join(dir, "fixture.json"), PRIVACY_CALLS: path.join(dir, "calls.jsonl") },
  });
  const calls: {method: string; url: string; body?: string}[] = readFileSync(path.join(dir, "calls.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { ...result, output: result.stdout + result.stderr, calls };
}

afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

describe("deletion-only provisioner transport", () => {
  it("serializes one privacy change and preserves every other writable value", () => {
    const agent = currentAgent();
    const result = run(agent);
    expect(result.status, result.output).toBe(0);
    expect(result.calls.map((call) => call.method)).toEqual(["GET", "PATCH", "GET"]);
    const body = JSON.parse(result.calls[1].body!);
    const expected = structuredClone(agent);
    for (const key of ["agent_id", "branch_id", "main_branch_id", "metadata"]) delete expected[key];
    delete expected.platform_settings.safety;
    expected.procedures = { procedure_synthetic: { procedure_id: "procedure_synthetic", version_id: "version_synthetic" } };
    expected.platform_settings.privacy.delete_transcript_and_pii = true;
    expect(body).toEqual(expected);
    expect(result.output).not.toContain(agent.conversation_config.agent.prompt.prompt);
    expect(result.output).not.toContain("synthetic-secret");
  });

  it.each(["absent", "null"])("preserves %s reasoning and absent optional fields", (presence) => {
    const agent = currentAgent();
    if (presence === "absent") delete agent.conversation_config.agent.prompt.reasoning_effort;
    const result = run(agent);
    expect(result.status, result.output).toBe(0);
    const body = JSON.parse(result.calls[1].body!);
    expect(Object.hasOwn(body.conversation_config.agent.prompt, "reasoning_effort")).toBe(presence === "null");
    expect(body.conversation_config.agent.prompt.reasoning_effort).toBe(presence === "null" ? null : undefined);
    expect(Object.hasOwn(body.conversation_config.agent.prompt, "rag")).toBe(false);
  });

  it("preserves typed maps, opaque references, overrides, and read-only hold audio", () => {
    const agent = currentAgent();
    agent.conversation_config.agent.dynamic_variables = { dynamic_variable_placeholders: {
      sample: { shareable_token: "ordinary data", request_headers: { sample: "ordinary data" } }, empty: null, zero: 0,
    } };
    agent.conversation_config.language_presets = { en: { overrides: { agent: { first_message: "Existing variant" } } } };
    agent.platform_settings.queueing_config = { enabled: false, wait_timeout_seconds: 180,
      hold_audio: { audio_path: "existing.wav", audio_url: "https://synthetic.example/hold.wav", original_filename: "hold.wav", duration_secs: 1, size_bytes: 12 } };
    agent.platform_settings.alerting = { notifiers: [{ type: "webhook", webhook_id: "webhook_synthetic" }], monitor_configs: {} };
    const result = run(agent);
    expect(result.status, result.output).toBe(0);
    const body = JSON.parse(result.calls[1].body!);
    expect(body.conversation_config).toEqual(agent.conversation_config);
    expect(body.platform_settings.alerting).toEqual(agent.platform_settings.alerting);
    expect(body.platform_settings.queueing_config).toEqual({ enabled: false, wait_timeout_seconds: 180 });
  });

  it("keeps an established empty procedure map explicit", () => {
    const agent = currentAgent();
    agent.procedures = {};
    const result = run(agent);
    expect(result.status, result.output).toBe(0);
    expect(JSON.parse(result.calls[1].body!).procedures).toEqual({});
  });

  it("makes no write when the validated target already enables deletion", () => {
    const agent = currentAgent();
    agent.platform_settings.privacy.delete_transcript_and_pii = true;
    const result = run(agent);
    expect(result.status, result.output).toBe(0);
    expect(result.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  const refusals: [string, (agent: Json) => void][] = [
    ["unknown root", (agent) => { agent.unknown = true; }],
    ["unknown nested writable field", (agent) => { agent.platform_settings.privacy.unknown = true; }],
    ["unknown field in a locator", (agent) => { agent.conversation_config.agent.prompt.custom_llm.api_key.extra = true; }],
    ["unsupported model", (agent) => { agent.conversation_config.agent.prompt.llm = "unsupported-model"; }],
    ["unsupported locator union", (agent) => { agent.conversation_config.agent.prompt.custom_llm.api_key.env_var_label = "AMBIGUOUS"; }],
    ["empty secret reference", (agent) => { agent.conversation_config.agent.prompt.custom_llm.api_key.secret_id = ""; }],
    ["missing secret reference", (agent) => { agent.conversation_config.agent.prompt.custom_llm.api_key = {}; }],
    ["missing required URL", (agent) => { delete agent.conversation_config.agent.prompt.custom_llm.url; }],
    ["missing writable root", (agent) => { delete agent.conversation_config; }],
    ["missing privacy boolean", (agent) => { delete agent.platform_settings.privacy.delete_transcript_and_pii; }],
    ["masked inline header", (agent) => { agent.conversation_config.agent.prompt.custom_llm.request_headers.Authorization = "***"; }],
    ["unpreservable inline token", (agent) => { agent.platform_settings.auth.shareable_token = "inline-token"; }],
    ["missing procedure membership", (agent) => { delete agent.procedures; }],
    ["null procedures", (agent) => { agent.procedures = null; }],
    ["missing procedure version", (agent) => { delete agent.procedures.procedure_synthetic.version_id; }],
    ["null procedure version", (agent) => { agent.procedures.procedure_synthetic.version_id = null; }],
    ["empty procedure version", (agent) => { agent.procedures.procedure_synthetic.version_id = ""; }],
    ["mismatched procedure membership", (agent) => { agent.procedures.procedure_synthetic.procedure_id = "other"; }],
    ["unknown procedure data", (agent) => { agent.procedures.procedure_synthetic.unknown = true; }],
    ["missing Main echo", (agent) => { delete agent.main_branch_id; }],
    ["non-Main branch", (agent) => { agent.main_branch_id = "other"; }],
    ["agent echo mismatch", (agent) => { agent.agent_id = "other"; }],
    ["branch echo mismatch", (agent) => { agent.branch_id = "other"; }],
    ["typed-map value mismatch", (agent) => { agent.conversation_config.language_presets = { en: { overrides: 0 } }; }],
    ["output-only workflow union", (agent) => {
      agent.workflow.edges = { edge: { source: "start", target: "start", forward_condition: {
        type: "expression", expression: { type: "llm", prompt: "Existing legacy prompt", value_schema: { type: "boolean", description: "Existing criterion" } },
      } } };
    }],
    ["schema minimum", (agent) => { agent.conversation_config.tts.speed = -1; }],
  ];
  it.each(refusals)("refuses %s before PATCH", (_name, change) => {
    const agent = currentAgent();
    change(agent);
    const result = run(agent);
    expect(result.status, result.output).toBe(1);
    expect(result.calls.map((call) => call.method)).toEqual(["GET"]);
    expect(result.output).not.toContain("Ordinary prompt");
    expect(result.output).not.toContain("synthetic-secret");
  });

  it.each(["target_is_main", "whole_agent_traffic_isolated", "executing_binding_verified", "remote_exclusive_writer_verified", "live_operation_approved", "agent_id", "branch_id"])(
    "refuses missing or mismatched %s attestation before any request", (key) => {
      const result = run(currentAgent(), { attestation: { [key]: false } });
      expect(result.status, result.output).toBe(1);
      expect(result.calls).toEqual([]);
    },
  );

  it.each([
    { httpFailure: "GET", methods: ["GET"] },
    { httpFailure: "PATCH", methods: ["GET", "PATCH"] },
    { networkFailure: "PATCH", methods: ["GET", "PATCH"] },
    { postHttpFailure: true, methods: ["GET", "PATCH", "GET"] },
    { postNetworkFailure: true, methods: ["GET", "PATCH", "GET"] },
    { drift: true, methods: ["GET", "PATCH", "GET"] },
    { postIdentity: true, methods: ["GET", "PATCH", "GET"] },
    { noEffect: true, methods: ["GET", "PATCH", "GET"] },
  ])("refuses failed or ambiguous transport/readback without retries: %j", (options) => {
    const result = run(currentAgent(), options);
    expect(result.status, result.output).toBe(1);
    expect(result.calls.map((call) => call.method)).toEqual(options.methods);
    expect(result.output).not.toContain("Synthetic private provider detail");
    expect(result.output).not.toContain("Synthetic failure with secret response text");
  });


  it.each(["--check", "--dry-run"])("rejects the unrelated %s mode without any request", (mode) => {
    const result = run(currentAgent(), { extraArgs: [mode] });
    expect(result.status, result.output).toBe(1);
    expect(result.calls).toEqual([]);
  });

});
