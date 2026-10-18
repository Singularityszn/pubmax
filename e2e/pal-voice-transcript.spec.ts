import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The voice panel on /pal, driven through the REAL ElevenLabs SDK against a
// stand-in for the provider's socket. The stand-in speaks the provider's own
// event shapes (initiation, audio, agent_response, tentative and final user
// transcripts), so the panel is proved on what it will receive, without a key
// or a paid minute. Shots land in artifacts/pal-voice-transcript/ (gitignored).

const SHOTS = "artifacts/pal-voice-transcript";
const SIGNED_URL = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_e2e&conversation_signature=e2e";

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

/** Half a second of a soft 220 Hz tone as base64 PCM16 at 16 kHz. */
function toneChunk(): string {
  const samples = 8_000;
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * 220 * index) / 16_000) * 0.25 * 0x7fff;
    buffer.writeInt16LE(Math.round(value), index * 2);
  }
  return buffer.toString("base64");
}

let eventId = 0;
function say(socket: WebSocketRoute, text: string): void {
  eventId += 1;
  socket.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: text, event_id: eventId } }));
  for (let chunk = 0; chunk < 3; chunk += 1) {
    socket.send(JSON.stringify({ type: "audio", audio_event: { audio_base_64: toneChunk(), event_id: eventId } }));
  }
}

function hear(socket: WebSocketRoute, text: string, tentative = false): void {
  eventId += 1;
  socket.send(JSON.stringify(tentative
    ? { type: "tentative_user_transcript", tentative_user_transcription_event: { user_transcript: text, event_id: eventId } }
    : { type: "user_transcript", user_transcription_event: { user_transcript: text, event_id: eventId } }));
}

async function openLiveVoice(page: Page): Promise<WebSocketRoute> {
  const timestamp = "2026-10-04T12:00:00.000Z";
  const pal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    name: "Ripley", adultAttestedAt: timestamp,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice, muted: false, hidden: false,
    proposalPreferences: { memories: false, routes: true }, masteryPoints: 0,
    createdAt: timestamp, updatedAt: timestamp,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/tool-turn", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/pub-pal/voice-token", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { available: true, retention: "provider_default" } });
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action === "release") return route.fulfill({ status: 204 });
    return route.fulfill({ json: { signedUrl: SIGNED_URL, conversationId: "conv_e2e_transcript", maxSessionSeconds: 180 } });
  });

  let resolveSocket!: (socket: WebSocketRoute) => void;
  const opened = new Promise<WebSocketRoute>((resolve) => { resolveSocket = resolve; });
  await page.routeWebSocket(/api\.elevenlabs\.io/, (socket) => {
    socket.onMessage((message) => {
      const event = JSON.parse(String(message)) as { type?: string };
      if (event.type !== "conversation_initiation_client_data") return;
      socket.send(JSON.stringify({
        type: "conversation_initiation_metadata",
        conversation_initiation_metadata_event: {
          conversation_id: "conv_e2e_transcript",
          agent_output_audio_format: "pcm_16000",
          user_input_audio_format: "pcm_16000",
        },
      }));
      resolveSocket(socket);
    });
  });

  await installAuthDoubles(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax:first-run-welcome:v1", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1, activatedAt: new Date().toISOString(),
    }));
  });
  await seedSignedIn(page, "A");
  await page.goto("/pal");
  const start = page.getByRole("button", { name: "Start voice chat", exact: true });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".palVoiceEmpty")).toContainText("the conversation shows up here");
  await expect(async () => {
    await start.click();
    await expect(page.getByRole("status").filter({ hasText: /Pal is (listening|talking)/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return opened;
}

for (const [width, theme] of [[390, "light"], [1280, "dark"]] as const) {
  test(`${width}px ${theme}: the voice panel prints the conversation and "show me the map" opens /map`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    await mkdir(SHOTS, { recursive: true });
    const socket = await openLiveVoice(page);

    // The portrait is a 3D head that lifts and nods on the Pal's own voice.
    // Off screen its loop sleeps, so the head is brought into view first.
    const head = page.locator(".palHomePortrait");
    await head.scrollIntoViewIfNeeded();
    await expect(head).toHaveAttribute("data-head-3d", "live");
    say(socket, "Evening. I'm Ripley. Tell me the night you want and I'll find it.");
    await expect.poll(
      () => head.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--pal-lift")) || 0),
      { timeout: 5_000, intervals: [50] },
    ).toBeGreaterThan(0.5);
    await head.screenshot({ path: `${SHOTS}/${width}-0-head-speaking.png` });
    const log = page.getByRole("log", { name: "Voice chat transcript" });
    await expect(log.locator(".palVoiceLine--pal")).toContainText("Tell me the night you want");
    await expect(page.locator(".palVoice")).toHaveAttribute("data-mode", "speaking");
    await page.waitForTimeout(500);
    await page.locator(".palVoice").screenshot({ path: `${SHOTS}/${width}-1-pal-speaking.png` });

    await expect(page.locator(".palVoice")).toHaveAttribute("data-mode", "listening", { timeout: 10_000 });
    hear(socket, "cheap pints near", true);
    await expect(log.locator(".palVoiceLine--live")).toContainText("cheap pints near");
    await page.locator(".palVoice").screenshot({ path: `${SHOTS}/${width}-2-hearing-you.png` });

    hear(socket, "Cheap pints near Soho for four of us");
    // The fake microphone plays a steady tone, so the live "hearing you" row
    // can sit under the final line; the final line is what is asserted.
    await expect(log.locator(".palVoiceLine--you:not(.palVoiceLine--live)").last()).toHaveText("YouCheap pints near Soho for four of us");
    say(socket, "The Toucan on Carlisle Street has a listed pint at £5.20. Want me to plan a route from there?");
    await expect(log.locator(".palVoiceLine--pal").last()).toContainText("The Toucan");

    hear(socket, "Show me the map");
    const mapCard = page.locator(".palVoiceMapCard");
    await expect(mapCard).toContainText("Opening the map");
    await page.locator(".palVoice").screenshot({ path: `${SHOTS}/${width}-3-opening-map.png` });
    await page.screenshot({ path: `${SHOTS}/${width}-4-page.png`, fullPage: width === 390 });
    await expect(page).toHaveURL(/\/map(?:\?|$)/, { timeout: 15_000 });
  });
}

test("Stay here keeps the person on the Pal, and the Pal's own words never open the map", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const socket = await openLiveVoice(page);
  say(socket, "Shall I show you the map?");
  const log = page.getByRole("log", { name: "Voice chat transcript" });
  await expect(log).toContainText("Shall I show you the map?");
  await page.waitForTimeout(2_000);
  await expect(page.locator(".palVoiceMapCard")).toHaveCount(0);

  hear(socket, "Open the map");
  await page.getByRole("button", { name: "Stay here", exact: true }).click();
  await page.waitForTimeout(2_000);
  await expect(page).toHaveURL(/\/pal$/);
  await expect(page.locator(".palVoiceMapCard")).toHaveCount(0);
});

test("the head stays a still photograph under reduced motion", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const socket = await openLiveVoice(page);
  say(socket, "Evening.");
  await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Evening.");
  const head = page.locator(".palHomePortrait");
  await expect(head).not.toHaveAttribute("data-head-3d", "live");
  await expect(head.locator(".palPortrait")).toHaveCSS("transform", "none");
});
