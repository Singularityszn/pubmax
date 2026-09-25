import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

// Live Pub Pal proof against a real deployment with ElevenLabs configured.
//
// The browser tests drive the real /pal page in headless Chromium. The fake
// microphone plays PUB_PAL_PROOF_WAV into a real ElevenLabs voice session, and
// the spec reads the session's own WebSocket frames to prove the spoken line
// was transcribed and the Pal answered with audio. Evidence lands in
// artifacts/pubpal-voice-proof/ for the PR. See docs/proof/pubpal-voices/README.md.

const LIVE_PROOF = process.env.PUB_PAL_PROOF_BASE_URL?.replace(/\/+$/, "");
const storageState = process.env.PUB_PAL_PROOF_STORAGE_STATE?.trim();
const wav = process.env.PUB_PAL_PROOF_WAV?.trim();
const EVIDENCE_DIR = "artifacts/pubpal-voice-proof";
const ROUTE_ACTIVATION_KEY = "pubmaxx.pub-pal-route-activation.v1";

test.use({
  ...(storageState ? { storageState } : {}),
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []),
    ],
  },
});

function requireProofEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live Pub Pal proof`);
  return value;
}

type VoiceFrame = { at: number; type: string; text?: string; audioBytes?: number };

function readVoiceFrame(payload: string | Buffer, at: number): VoiceFrame | null {
  try {
    const event = JSON.parse(payload.toString()) as {
      type?: string;
      user_transcription_event?: { user_transcript?: string };
      agent_response_event?: { agent_response?: string };
      audio_event?: { audio_base_64?: string };
    };
    if (event.type === "user_transcript") {
      return { at, type: "user_transcript", text: event.user_transcription_event?.user_transcript ?? "" };
    }
    if (event.type === "agent_response") {
      return { at, type: "agent_response", text: event.agent_response_event?.agent_response ?? "" };
    }
    if (event.type === "audio") {
      const audio = event.audio_event?.audio_base_64 ?? "";
      return { at, type: "audio", audioBytes: Buffer.from(audio, "base64").length };
    }
    return null;
  } catch {
    return null;
  }
}

async function prepareReturningVisitor(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, activatedAt: new Date().toISOString() }),
    );
  }, ROUTE_ACTIVATION_KEY);
}

test.describe("Pub Pal live voice", () => {
  test.skip(!LIVE_PROOF, "live proof runs on demand: set PUB_PAL_PROOF_BASE_URL");
  const baseUrl = LIVE_PROOF;

  test("voice token returns a signed session and species voice override", async ({ request }) => {
    const bearer = requireProofEnv("PUB_PAL_PROOF_BEARER");
    const response = await request.post(`${baseUrl}/api/pub-pal/voice-token`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.signedUrl).toBeTruthy();
    expect(body.overrides?.voiceId).toBeTruthy();
  });

  test("text ask answers through the concierge bridge", async ({ request }) => {
    const bearer = requireProofEnv("PUB_PAL_PROOF_BEARER");
    const response = await request.post(`${baseUrl}/api/ask`, {
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      data: { query: "Cheapest pint near Camden tonight" },
    });
    expect(response.status()).toBe(200);
  });

  test("a person types to the Pal in the browser and gets a reply", async ({ page }) => {
    await prepareReturningVisitor(page);
    await page.goto(`${baseUrl}/pal/chat`);
    await page.getByRole("textbox", { name: /Describe the outing/i }).fill(
      "Cheapest pint in Camden tonight",
    );
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 30_000 });
    const answer = page.locator(".palChatRow--pal").last().locator(".palChatBubble").first();
    await expect(answer).not.toBeEmpty();

    await mkdir(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: `${EVIDENCE_DIR}/typed-chat.png`, fullPage: true });
  });

  test("a person talks to the Pal in the browser and hears it answer", async ({ page }) => {
    requireProofEnv("PUB_PAL_PROOF_STORAGE_STATE");
    requireProofEnv("PUB_PAL_PROOF_WAV");
    test.setTimeout(120_000);

    const started = Date.now();
    const frames: VoiceFrame[] = [];
    page.on("websocket", (socket) => {
      if (!/elevenlabs/i.test(socket.url())) return;
      socket.on("framereceived", ({ payload }) => {
        const frame = readVoiceFrame(payload, Date.now() - started);
        if (frame) frames.push(frame);
      });
    });

    await prepareReturningVisitor(page);
    await page.goto(`${baseUrl}/pal`);
    await page.getByRole("button", { name: "Start voice chat" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Pal is listening" })).toBeVisible({
      timeout: 30_000,
    });

    const spokenAt = () =>
      frames.find((frame) => frame.type === "user_transcript" && frame.text?.trim())?.at;
    await expect.poll(spokenAt, { timeout: 60_000 }).toBeDefined();
    const heardAt = spokenAt() as number;

    await expect
      .poll(
        () =>
          frames.some((frame) => frame.type === "agent_response" && frame.at >= heardAt && frame.text?.trim()) &&
          frames.some((frame) => frame.type === "audio" && frame.at >= heardAt && (frame.audioBytes ?? 0) > 0),
        { timeout: 60_000 },
      )
      .toBe(true);

    await mkdir(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: `${EVIDENCE_DIR}/voice-session.png`, fullPage: true });
    await writeFile(
      `${EVIDENCE_DIR}/voice-session.json`,
      `${JSON.stringify({ at: new Date().toISOString(), baseUrl, frames }, null, 2)}\n`,
    );

    await page.getByRole("button", { name: "End" }).click();
  });
});
