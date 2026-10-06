#!/usr/bin/env node
// Live proof: one text-only ElevenLabs agent turn that should call search_venues.
// Usage (requires ELEVENLABS_API_KEY, ELEVENLABS_PUB_PAL_AGENT_ID, ELEVENLABS_LLM_SHARED_SECRET):
//   node scripts/pubpal/prove-pal-text-tool.mjs --base-url https://pubmaxxing.com

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

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

loadDotEnv();

const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
if (!apiKey || !agentId) {
  console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_PUB_PAL_AGENT_ID");
  process.exit(1);
}

const query = "Name two quiet pubs in Clapham with listed prices.";

const signed = await fetch(
  `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}&include_conversation_id=true`,
  { headers: { "xi-api-key": apiKey } },
);
if (!signed.ok) {
  console.error("Signed URL failed", signed.status);
  process.exit(1);
}
const { signed_url: signedUrl } = await signed.json();
if (!signedUrl) {
  console.error("No signed_url");
  process.exit(1);
}

let toolSeen = false;
let agentText = "";

await new Promise((resolve, reject) => {
  const ws = new WebSocket(signedUrl);
  const timer = setTimeout(() => {
    ws.close();
    reject(new Error("timeout"));
  }, 45000);
  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: {
            text_only: true,
            client_events: [
              "agent_response",
              "agent_response_complete",
              "agent_tool_response",
              "conversation_initiation_metadata",
              "ping",
            ],
          },
        },
      }),
    );
  });
  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    if (payload.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", event_id: payload.ping_event?.event_id ?? 0 }));
      return;
    }
    if (payload.type === "conversation_initiation_metadata") {
      ws.send(JSON.stringify({ type: "user_message", text: query }));
      return;
    }
    if (payload.type === "agent_tool_response" || payload.type === "agent_tool_response_full_payload") {
      toolSeen = true;
    }
    if (payload.type === "agent_response") {
      agentText = payload.agent_response_event?.agent_response ?? "";
      return;
    }
    if (payload.type === "agent_response_complete") {
      clearTimeout(timer);
      ws.close();
      resolve(undefined);
    }
  });
  ws.addEventListener("error", () => reject(new Error("ws error")));
});

console.log(JSON.stringify({ toolSeen, agentTextLength: agentText.length, agentTextPreview: agentText.slice(0, 240) }, null, 2));
if (!toolSeen) process.exit(2);
