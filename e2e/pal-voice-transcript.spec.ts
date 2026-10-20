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

/** Half a second of speech-band harmonics as base64 PCM16 at 16 kHz. */
function toneChunk(): string {
  const samples = 8_000;
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    // A lone tone fills too few spectrum bins to exercise the voice meter.
    let wave = 0;
    for (let harmonic = 1; harmonic <= 20; harmonic += 1) {
      wave += Math.sin((2 * Math.PI * 120 * harmonic * index) / 16_000);
    }
    const value = (wave / 20) * 0.5 * 0x7fff;
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

async function openLiveVoice(page: Page, memoryProposals = false): Promise<WebSocketRoute> {
  const timestamp = "2026-10-04T12:00:00.000Z";
  const pal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    name: "Ripley", adultAttestedAt: timestamp,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice, muted: false, hidden: false,
    proposalPreferences: { memories: memoryProposals, routes: true }, masteryPoints: 0,
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

for (const width of [390, 1440]) {
  test(`${width}px: real SDK tool events show four mapped pubs and require a tap before keeping a voice memory`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const socket = await openLiveVoice(page, true);
    const query = "Find me four pubs in Soho and show them on the map.";
    hear(socket, query);
    const response = await page.request.post("/api/pub-pal/chat", { data: { query } });
    expect(response.ok()).toBe(true);
    const answer = await response.json();
    expect(answer.cards).toHaveLength(4);
    const deliver = (tool: string, result: unknown) => {
      const request = { tool_name: tool, tool_call_id: `${tool}-${eventId}`, tool_type: "webhook", event_id: eventId };
      socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
      socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
        ...request, is_error: false, is_called: true, full_tool_result: JSON.stringify({ requestedTool: tool, result }),
      } }));
    };
    deliver("venue_prices", { ok: true, tool: "search_venues", answerHint: answer.answer, cards: answer.cards });
    await expect(page.getByRole("list", { name: "Pubs from the voice answer" }).locator("li")).toHaveCount(4);
    const map = page.getByRole("region", { name: "4 pubs on the map" });
    await map.scrollIntoViewIfNeeded();
    await expect(map.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/pal$/);
    await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
    await page.screenshot({ path: `artifacts/pubpal-complete-1019/voice-map-${width}.png` });

    deliver("venue_drinks", { ok: true, tool: "venue_drinks", answerHint: "Two recorded drinks.", cards: [
      { ...answer.cards[0], key: "wine", title: "Red wine at Shakespeares Head", price: 7.5, note: "Seen 2 October 2026. Corroboration pending.", provenance: { kind: "community-price", label: "People-logged" } },
      { ...answer.cards[0], key: "meal", title: "Lunch at Shakespeares Head", price: 18, note: "Published menu. Read 2 October 2026. Availability unknown.", provenance: { kind: "published-menu", label: "Pub menu" }, menuEvidence: { kind: "published-menu", itemId: "lunch", itemName: "Lunch", menu: "food", category: "meal", currency: "GBP", serving: "portion", caloriesKcal: null, caloriesProvenance: null, dietary: [], dietaryProvenance: null, observedAt: "2026-10-02", source: "Pub menu", sourceUrl: null, licence: "Published menu", availability: "unknown" } },
    ] });
    const sourced = page.getByRole("list", { name: "Pubs from the voice answer" });
    await expect(sourced.locator("li")).toHaveCount(6);
    for (const card of answer.cards) {
      const recommendation = sourced.locator("li").filter({ has: page.getByRole("link", { name: card.title, exact: true }) });
      await expect(recommendation).toHaveCount(1);
      await expect(recommendation).toContainText(card.note);
      await expect(recommendation.locator('.priceBadge[title]')).toHaveCount(typeof card.price === "number" ? 1 : 0);
      if (typeof card.price === "number") {
        await expect(recommendation.locator('.priceBadge')).toHaveText(`£${card.price.toFixed(2)}`);
      } else {
        await expect(recommendation.locator('.priceBadge')).toHaveCount(0);
      }
    }
    const wine = sourced.locator("li").filter({ has: page.getByRole("link", { name: "Red wine at Shakespeares Head", exact: true }) });
    const meal = sourced.locator("li").filter({ has: page.getByRole("link", { name: "Lunch at Shakespeares Head", exact: true }) });
    await expect(wine).toContainText("£7.50");
    await expect(wine).toContainText("Seen 2 October 2026. Corroboration pending.");
    await expect(meal).toContainText("£18.00");
    await expect(meal).toContainText("Published menu. Read 2 October 2026. Availability unknown.");
    await expect(wine.locator('.priceBadge[title]')).toHaveCount(0);
    await expect(meal.locator('.priceBadge[title]')).toHaveCount(0);
    await expect(map).toBeVisible();
    await expect(map.locator(".palChatMapPin")).toHaveCount(4);

    let writes = 0;
    const memories: Array<Record<string, unknown>> = [];
    await page.route("**/api/pub-pal/memories", async (route) => {
      if (route.request().method() === "POST") {
        writes += 1;
        const memory = { id: "voice-memory-1", ...route.request().postDataJSON(), provenance: "user_confirmed", createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" };
        memories.push(memory);
        return route.fulfill({ status: 201, json: { memory } });
      }
      return route.fulfill({ json: { memories } });
    });
    hear(socket, "I prefer cask ale.");
    deliver("propose_memory", { ok: true, tool: "propose_memory", answerHint: "A card is waiting. Nothing is saved.", proposals: [{ id: "voice-test-memory-1", kind: "remember_memory", memoryKind: "drink_preference", value: "Cask ale", label: "Remember: Cask ale" }] });
    const confirm = page.getByRole("button", { name: "Remember: Cask ale", exact: true });
    await expect(confirm).toBeVisible();
    expect(writes).toBe(0);
    await confirm.click();
    await expect(page.getByRole("status").filter({ hasText: "Saved: Cask ale" })).toBeVisible();
    expect(writes).toBe(1);
    await expect(page.locator(".palMemoryList")).toContainText("Cask ale");
    await page.getByRole("button", { name: "End", exact: true }).click();
    await page.reload();
    await expect(page.locator(".palMemoryList")).toContainText("Cask ale");
  });
}

for (const [width, theme] of [[390, "light"], [1280, "dark"]] as const) {
  test(`${width}px ${theme}: the voice panel prints the conversation and "show me the map" opens /map`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    await mkdir(SHOTS, { recursive: true });
    const socket = await openLiveVoice(page);

    // On a phone the panel carries its own live head; on a desktop the big
    // portrait stays in view beside the panel, so the small one is hidden.
    const face = page.locator(".palVoiceFace");
    if (width === 390) {
      await expect(face).toBeVisible();
      await expect(face).toHaveAttribute("data-head-3d", "live");
    } else {
      await expect(face).toBeHidden();
    }

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
  // The panel's own head lifts on the Pal's voice while the big one is off screen.
  const face = page.locator(".palVoiceFace");
  await expect.poll(
    () => face.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--pal-lift")) || 0),
    { timeout: 5_000, intervals: [50] },
  ).toBeGreaterThan(0.5);
  await page.locator(".palVoice").screenshot({ path: `${SHOTS}/390-5-panel-face-speaking.png` });
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
