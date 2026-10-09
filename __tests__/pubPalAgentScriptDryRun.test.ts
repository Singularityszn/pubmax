import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "pubpal", "create-elevenlabs-agent.mjs");
const SECRET = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

const directories: string[] = [];

function emptyCwd() {
  const directory = mkdtempSync(path.join(tmpdir(), "pubmax-pubpal-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

function dryRun() {
  return spawnSync(
    process.execPath,
    [SCRIPT, "--dry-run", "--base-url", "https://pubmaxxing.com"],
    {
      // An empty cwd so the script's own .env.local read cannot supply values.
      cwd: emptyCwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ELEVENLABS_LLM_SHARED_SECRET: SECRET,
        ELEVENLABS_API_KEY: "",
        ELEVENLABS_PUB_PAL_AGENT_ID: "",
      },
    },
  );
}

describe("pubpal:agent dry run", () => {
  it("keeps social turns separate from factual requests in the provisioned prompt and tools", () => {
    const printed = dryRun().stdout.split("\nDefault voice resolved:")[0] ?? "";
    const body = JSON.parse(printed.slice(printed.indexOf("{"), printed.lastIndexOf("}") + 1));
    const prompt: string = body.conversation_config.agent.prompt.prompt;
    expect(prompt).toContain(
      "If the person only greets you, reply with one short line that moves forward: Hey. Where are you heading tonight?",
    );
    expect(prompt).toContain(
      "Never repeat a question you have already asked in this conversation. If you already asked where they are heading, acknowledge briefly and wait for them to say more.",
    );
    // The voice opener already asks this question, so no greeting rule may make the agent ask it again.
    expect(prompt).not.toContain("What kind of night are you planning?");
    expect(prompt).toContain("Do not call any tool for a greeting alone. Do not infer a request for listings.");
    expect(prompt).toContain("For thanks alone, reply briefly without a tool.");
    expect(prompt).toContain("Use a factual tool only when the person asks for the information that tool provides.");
    expect(prompt).toContain("A message label is context. It is not a request for tonight's listings.");
    expect(prompt.indexOf("Do not call any tool for a greeting alone.")).toBeLessThan(
      prompt.indexOf("Call the PUBMAXX webhook tools before any factual answer."),
    );
    expect(prompt).toContain("On the first substantive request, call recall_memories once before any factual tool.");
    expect(prompt).not.toContain("At the start of a conversation, call recall_memories");
    const tools = new Map<string, { description: string }>(
      body.webhook_tools.map((tool: { name: string; description: string }) => [tool.name, tool]),
    );
    expect(tools.get("tonight_now")?.description).toBe(
      "Use only for explicit questions about sourced events or listings running now, tonight, or later, or how busy a pub or area is. Do not use for greetings or message labels. For crowd questions, explain that no live crowd reading exists. Never claim live crowd levels.",
    );
    expect(tools.get("recall_memories")?.description).toContain("first substantive request");
    expect(body.platform_settings.privacy.delete_transcript_and_pii).toBe(true);
  });

  it("prints the agent it would write without printing the shared secret", () => {
    const result = dryRun();
    expect(result.status).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain(SECRET);
    expect(output).toContain("https://pubmaxxing.com/api/pub-pal/tools/search_venues");
    expect(output).toContain("gemini-2.5-flash-lite");
  });

  it("still describes the agent it would write", () => {
    const printed = dryRun().stdout.split("\nDefault voice resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      conversation_config: {
        agent: { prompt: { prompt: string; llm: string; tool_ids: string[] } };
      };
      webhook_tools: Array<{
        api_schema: {
          url: string;
          request_headers: { "x-elevenlabs-llm-secret": { secret_id: string } };
          request_body_schema: {
            properties: { conversation_id: { dynamic_variable?: string } };
          };
        };
      }>;
      llm: string;
      platform_settings: {
        auth: { enable_auth: boolean; allowlist: unknown[] };
        privacy: { retention_days: number; zero_retention_mode: boolean };
        overrides: {
          conversation_config_override: {
            agent: { prompt: { prompt: boolean }; first_message: boolean };
            tts: { voice_id: boolean };
            conversation: { text_only: boolean };
          };
        };
      };
    };
    expect(body.llm).toBe("gemini-2.5-flash-lite");
    expect(body.conversation_config.agent.prompt.llm).toBe("gemini-2.5-flash-lite");
    expect(body.webhook_tools.map((tool) => tool.api_schema.url)).toContain(
      "https://pubmaxxing.com/api/pub-pal/tools/search_venues",
    );
    for (const tool of body.webhook_tools) {
      expect(tool.api_schema.request_body_schema.properties.conversation_id).toEqual({
        type: "string",
        dynamic_variable: "system__conversation_id",
      });
      expect(tool.api_schema.request_headers["x-elevenlabs-llm-secret"].secret_id).toBe("redacted");
    }
    expect(body.conversation_config.agent.prompt.prompt).toContain(
      "Never invent a pub, a price, an opening hour, or an event.",
    );
    expect(body.conversation_config.agent.prompt.prompt).not.toContain("{{");
    // A conversation may start only with a signed URL, never with the agent id alone.
    expect(body.platform_settings.auth).toEqual({ enable_auth: true, allowlist: [] });
    expect(body.platform_settings.privacy.retention_days).toBe(-1);
    expect(body.platform_settings.privacy.zero_retention_mode).toBe(true);
    expect(body.platform_settings.overrides.conversation_config_override).toEqual({
      agent: { prompt: { prompt: false }, first_message: true },
      tts: { voice_id: true },
      conversation: { text_only: true },
    });
  });

  it("writes the product voice cap, not a longer provider window", async () => {
    const printed = dryRun().stdout.split("\nDefault voice resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      conversation_config: { conversation: { max_duration_seconds: number } };
    };
    const { PAL_VOICE_MAX_SESSION_SECONDS } = await import("@/lib/palVoiceMetering");
    expect(PAL_VOICE_MAX_SESSION_SECONDS).toBe(180);
    expect(body.conversation_config.conversation.max_duration_seconds).toBe(
      PAL_VOICE_MAX_SESSION_SECONDS,
    );
  });
  it("sends the voice events and the events typed chat needs to find the end of a turn", () => {
    const printed = dryRun().stdout.split("\nDefault voice resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      conversation_config: { conversation: { client_events: string[] } };
    };
    expect(body.conversation_config.conversation.client_events).toEqual(
      expect.arrayContaining([
        "audio",
        "interruption",
        "user_transcript",
        "agent_response",
        "agent_tool_request",
        "agent_tool_response",
        "agent_response_complete",
      ]),
    );
  });

  it("speaks a checking line before every tool and keeps confirm proposals uninterrupted", () => {
    const printed = dryRun().stdout.split("\nDefault voice resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      webhook_tools: Array<{
        name: string;
        pre_tool_speech: string;
        execution_mode: string;
        interruption_mode: string;
      }>;
    };
    const confirmTools = ["propose_plan", "propose_map_action", "report_occupancy", "propose_memory"];
    expect(body.webhook_tools.length).toBe(16);
    const byName = new Map(body.webhook_tools.map((tool) => [tool.name, tool]));
    expect(byName.get("recall_memories")).toMatchObject({
      pre_tool_speech: "force",
      execution_mode: "immediate",
      interruption_mode: "allow",
    });
    expect(byName.get("propose_memory")).toMatchObject({
      pre_tool_speech: "force",
      execution_mode: "immediate",
      interruption_mode: "disable_during_tool_and_turn",
    });
    for (const tool of body.webhook_tools) {
      expect(tool.pre_tool_speech).toBe("force");
      expect(tool.execution_mode).toBe("immediate");
      expect(tool.interruption_mode).toBe(
        confirmTools.includes(tool.name) ? "disable_during_tool_and_turn" : "allow",
      );
    }
    expect(
      body.webhook_tools.filter((tool) => tool.interruption_mode !== "allow").map((tool) => tool.name),
    ).toEqual(confirmTools);
  });
});
