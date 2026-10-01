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
  it("binds every webhook receipt to the runtime conversation rather than an LLM guess", () => {
    const printed = dryRun().stdout.split("\nDefault voice resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      webhook_tool_configs?: Array<{
        api_schema: {
          request_body_schema: {
            required: string[];
            properties: Record<string, unknown>;
          };
        };
      }>;
    };
    expect(body.webhook_tool_configs?.length).toBe(14);
    for (const tool of body.webhook_tool_configs ?? []) {
      expect(tool.api_schema.request_body_schema.required).toContain("conversation_id");
      expect(tool.api_schema.request_body_schema.properties.conversation_id).toEqual({
        type: "string",
        dynamic_variable: "system__conversation_id",
      });
    }
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
        agent: { prompt: { llm: string; tool_ids: string[] } };
      };
      webhook_tools: string[];
      llm: string;
      platform_settings: {
        privacy: { retention_days: number; zero_retention_mode: boolean };
        overrides: {
          conversation_config_override: {
            agent: { prompt: { prompt: boolean }; first_message: boolean };
            tts: { voice_id: boolean };
          };
        };
      };
    };
    expect(body.llm).toBe("gemini-2.5-flash-lite");
    expect(body.conversation_config.agent.prompt.llm).toBe("gemini-2.5-flash-lite");
    expect(body.webhook_tools).toContain(
      "https://pubmaxxing.com/api/pub-pal/tools/search_venues",
    );
    expect(body.platform_settings.privacy.retention_days).toBe(-1);
    expect(body.platform_settings.privacy.zero_retention_mode).toBe(true);
    expect(body.platform_settings.overrides.conversation_config_override).toEqual({
      agent: { prompt: { prompt: true }, first_message: true },
      tts: { voice_id: true },
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
});
