import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { storeThemeChoice } from "./helpers/themeClock";

// The voice panel on /pal, driven through the REAL ElevenLabs SDK against a
// stand-in for the provider's socket. The stand-in speaks the provider's own
// event shapes (initiation, audio, agent_response, tentative and final user
// transcripts), so the panel is proved on what it will receive, without a key
// or a paid minute. Shots land in artifacts/pal-voice-transcript/ (gitignored).

const SHOTS = process.env.PAL_VOICE_EVIDENCE_DIR ?? "artifacts/pal-voice-transcript";
const SIGNED_URL = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_e2e&conversation_signature=e2e";

test.use({
  serviceWorkers: "block",
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

/** One Pal line in three audio chunks, each with the provider's character timing. */
function sayAligned(socket: WebSocketRoute, text: string): void {
  eventId += 1;
  socket.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: text, event_id: eventId } }));
  const chars = [...text];
  const size = Math.ceil(chars.length / 3);
  for (let start = 0; start < chars.length; start += size) {
    const part = chars.slice(start, start + size);
    const alignment = { chars: part, char_start_times_ms: part.map((_, index) => index * 20), char_durations_ms: part.map(() => 20) };
    socket.send(JSON.stringify({ type: "audio", audio_event: { audio_base_64: toneChunk(), event_id: eventId, alignment } }));
  }
}

function hear(socket: WebSocketRoute, text: string, tentative = false): void {
  eventId += 1;
  socket.send(JSON.stringify(tentative
    ? { type: "tentative_user_transcript", tentative_user_transcription_event: { user_transcript: text, event_id: eventId } }
    : { type: "user_transcript", user_transcription_event: { user_transcript: text, event_id: eventId } }));
}

/** Sign in as A with a Pal and stub the provider socket. mapOnly never opens /pal. */
async function preparePalAccount(page: Page, memoryProposals = false, firstMessage?: string, hidden = false, under18 = false, mapOnly = false): Promise<{ opened: Promise<WebSocketRoute> }> {
  const timestamp = "2026-10-04T12:00:00.000Z";
  let pal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    name: "Ripley", adultAttestedAt: timestamp,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice, muted: false, hidden,
    proposalPreferences: { memories: memoryProposals, routes: true }, masteryPoints: 0,
    createdAt: timestamp, updatedAt: timestamp,
  };
  await page.route("**/api/pub-pal", (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ json: { ok: true } });
    if (route.request().method() === "PATCH") pal = { ...pal, ...route.request().postDataJSON() };
    return route.fulfill({ json: { pal, adultOnFile: !under18, under18 } });
  });
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/tool-turn", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/pub-pal/voice-token", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { available: true, retention: "provider_default" } });
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action === "release") return route.fulfill({ status: 204 });
    return route.fulfill({ json: { signedUrl: SIGNED_URL, conversationId: "conv_e2e_transcript", maxSessionSeconds: 180, ...(firstMessage ? { overrides: { firstMessage, voiceId: null } } : {}) } });
  });

  let resolveSocket!: (socket: WebSocketRoute) => void;
  const opened = new Promise<WebSocketRoute>((resolve) => { resolveSocket = resolve; });
  await page.routeWebSocket(/api\.elevenlabs\.io/, (socket) => {
    socket.onMessage((message) => {
      const event = JSON.parse(String(message)) as { type?: string };
      if (event.type !== "conversation_initiation_client_data") return;
      if (firstMessage) {
        expect(event).toMatchObject({ conversation_config_override: { agent: { first_message: firstMessage } } });
      }
      socket.send(JSON.stringify({
        type: "conversation_initiation_metadata",
        conversation_initiation_metadata_event: {
          conversation_id: "conv_e2e_transcript",
          agent_output_audio_format: "pcm_16000",
          user_input_audio_format: "pcm_16000",
        },
      }));
      if (firstMessage) say(socket, firstMessage);
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
  if (mapOnly) {
    await page.goto("/map");
    await page.evaluate((savedPal) => {
      localStorage.setItem("__e2e_signed_in_account", "A");
      localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(savedPal));
    }, pal);
  } else {
    await seedSignedIn(page, "A");
  }
  const identityReady = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/identity/handle/current" && response.status() === 200,
  );
  await page.reload();
  await identityReady;
  if (mapOnly) {
    await page.evaluate((savedPal) => localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(savedPal)), pal);
    return { opened };
  }
  await expect(page.getByRole("button", { name: "Account options for Karan", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^Pub Pal(?:,.*)?$/ }).first().click();
  await expect(page).toHaveURL(/\/pal$/);
  await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toBeVisible({ timeout: 30_000 });
  // Wrapped, so awaiting the account does not also wait for the socket.
  return { opened };
}

async function openLiveVoice(page: Page, memoryProposals = false, firstMessage?: string, hidden = false): Promise<WebSocketRoute> {
  const { opened } = await preparePalAccount(page, memoryProposals, firstMessage, hidden);
  const start = page.getByRole("button", { name: "Start voice chat", exact: true });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".palVoiceEmpty")).toContainText("the conversation shows up here");
  // Only a dropped tap is tapped again. A taken tap swaps Start for End, and
  // a session that is slow to say it is listening must not be re-tapped
  // through a button that is gone (e2e/price-intent-lifecycle.spec.ts).
  await expect(async () => {
    if (await start.isVisible()) await start.click({ timeout: 2_000 });
    await expect(page.getByRole("status").filter({ hasText: /Pal is (listening|talking)/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return opened;
}

test.describe("phone voice map tap targets", () => {
  test.use({ hasTouch: true });

  for (const pinNumber of [1, 2, 3, 4]) {
    test(`independent transport replies keep four pins tappable and pin ${pinNumber} opens its pub`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      const socket = await openLiveVoice(page);
      hear(socket, "Find four pubs in Soho and check Tube delays.");
      const response = await page.request.post("/api/pub-pal/chat", { data: {
        query: "Find me four pubs in Soho and show them on the map.",
      } });
      expect(response.ok()).toBe(true);
      const answer = await response.json();
      expect(answer.cards).toHaveLength(4);
      let toolId = 0;
      const deliver = (tool: string, cards: unknown[]) => {
        const request = { tool_name: tool, tool_call_id: `transport-${++toolId}`, tool_type: "webhook", event_id: eventId };
        socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
        socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
          ...request, is_error: false, is_called: true,
          full_tool_result: JSON.stringify({ requestedTool: tool, result: { ok: true, tool, answerHint: "Recorded results.", cards } }),
        } }));
      };
      const map = page.getByRole("region", { name: "4 pubs on the map" });
      const list = page.getByRole("list", { name: "Pubs from the voice answer" });
      const checkPins = async () => {
        await map.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await expect(map.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
        await expect(map.locator(".palChatMapPin")).toHaveCount(4);
        await expect.poll(() => map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => {
          const box = pin.getBoundingClientRect();
          const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return target === pin || pin.contains(target);
        }))).toEqual([true, true, true, true]);
        for (const card of answer.cards) {
          const pin = map.locator(`.palChatMapPin[data-venue-id="${card.venueId}"]`);
          await expect(pin).toHaveAttribute("href", `/map?sel=${card.venueId}`);
          await pin.tap({ trial: true });
        }
      };
      deliver("search_venues", answer.cards);
      await expect(list.locator("li")).toHaveCount(4);
      await checkPins();
      for (const tool of ["city_status", "journey"]) {
        deliver(tool, [{ key: tool, title: `${tool} answer`, note: "Transport information." }]);
        say(socket, `${tool} completed.`);
        await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText(`${tool} completed.`);
        await expect(list.locator("li")).toHaveCount(4);
        await checkPins();
      }
      await test.info().attach("voice-map-after-transport", { body: await map.screenshot({ path: test.info().outputPath("voice-map-after-transport.png") }), contentType: "image/png" });
      const pin = map.locator(".palChatMapPin").nth(pinNumber - 1);
      const destination = await pin.getAttribute("href");
      await pin.tap();
      await expect(page).toHaveURL(new RegExp(`${destination!.replace("?", "\\?")}$`));
    });
  }
});

for (const width of [390, 1440]) {
  const mapAsk = width === 390 ? "spoken" : "typed";
  test(`${width}px: real SDK tool events show four mapped pubs, confirm memory, and open /map from a ${mapAsk} ask`, async ({ page }) => {
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
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/voice-map-${width}.png` });

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
    await expect(map).toBeVisible();
    if (mapAsk === "spoken") {
      hear(socket, "Show me the map");
    } else {
      await page.locator(".palVoice input").fill("Show me the map");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/map(?:\?|$)/);
    const bar = page.getByRole("region", { name: "Voice chat with Ripley" });
    await expect(bar).toBeVisible();
    say(socket, "Your recommended pubs are on the map.");
    await expect(bar).toContainText("Your recommended pubs are on the map.");
    await page.getByRole("button", { name: "End", exact: true }).click();
    await page.goto("/pal");
    await page.reload();
    await expect(page.locator(".palMemoryList")).toContainText("Cask ale");
  });
}

for (const [width, theme] of [
  [390, "light"], [390, "dark"],
  [768, "light"], [768, "dark"],
  [1440, "light"], [1440, "dark"],
] as const) {
  test(`${width}px ${theme}: "show me the map" opens /map and the same voice call carries on there`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await storeThemeChoice(page, theme);
    await page.emulateMedia({ colorScheme: theme });
    await mkdir(SHOTS, { recursive: true });
    let releases = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/pub-pal/voice-token" && request.postDataJSON()?.action === "release") releases += 1;
    });
    const socket = await openLiveVoice(page);
    let socketClosed = false;
    socket.onClose(() => { socketClosed = true; });

    // On a phone the panel carries its own live head; on a desktop the big
    // portrait stays in view beside the panel, so the small one is hidden.
    // A head draws in one of two live modes (components/pal/usePalHead3D.ts):
    // "mesh" where the browser draws the 3D model, "live" where the posed
    // photograph stands in for it. Either is a head that moves.
    const LIVE_HEAD = /^(?:live|mesh)$/;
    const face = page.locator(".palVoiceFace");
    if (width <= 900) {
      await expect(face).toBeVisible();
      await expect(face).toHaveAttribute("data-head-3d", LIVE_HEAD);
    } else {
      await expect(face).toBeHidden();
    }

    // The portrait is a 3D head that lifts and nods on the Pal's own voice.
    // Off screen its loop sleeps, so the head is brought into view first.
    // The hook poses the portrait's own frame (components/pal/PalPortrait.tsx),
    // not the hero cell around it, so the frame is what is read.
    const head = page.locator(".palHomePortrait .palPortrait");
    await head.scrollIntoViewIfNeeded();
    await expect(head).toHaveAttribute("data-head-3d", LIVE_HEAD);
    say(socket, "Evening. I'm Ripley. Tell me the night you want and I'll find it.");
    await expect.poll(
      () => head.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--pal-lift")) || 0),
      { timeout: 5_000, intervals: [50] },
    ).toBeGreaterThan(0.5);
    await head.screenshot({ path: `${SHOTS}/${width}-${theme}-0-head-speaking.png` });
    const log = page.getByRole("log", { name: "Voice chat transcript" });
    await expect(log.locator(".palVoiceLine--pal")).toContainText("Tell me the night you want");
    await expect(page.locator(".palVoice")).toHaveAttribute("data-mode", "speaking");
    await page.locator(".palVoice").screenshot({ path: `${SHOTS}/${width}-${theme}-1-pal-speaking.png` });

    await expect(page.locator(".palVoice")).toHaveAttribute("data-mode", "listening", { timeout: 10_000 });
    hear(socket, "cheap pints near", true);
    await expect(log.locator(".palVoiceLine--live")).toContainText("cheap pints near");
    await page.locator(".palVoice").screenshot({ path: `${SHOTS}/${width}-${theme}-2-hearing-you.png` });

    hear(socket, "Cheap pints near Soho for four of us");
    // The fake microphone plays a steady tone, so the live "hearing you" row
    // can sit under the final line; the final line is what is asserted.
    await expect(log.locator(".palVoiceLine--you:not(.palVoiceLine--live)").last()).toHaveText("YouCheap pints near Soho for four of us");
    say(socket, "The Toucan on Carlisle Street has a listed pint at £5.20. Want me to plan a route from there?");
    await expect(log.locator(".palVoiceLine--pal").last()).toContainText("The Toucan");

    hear(socket, "Show me the map");
    const mapCard = page.locator(".palVoiceMapCard");
    await expect(mapCard).toContainText("Opening the map");
    await page.locator(".palVoice").screenshot({ path: `${SHOTS}/${width}-${theme}-3-opening-map.png` });
    await page.screenshot({ path: `${SHOTS}/${width}-${theme}-4-page.png`, fullPage: width === 390 });
    await expect(page).toHaveURL(/\/map(?:\?|$)/, { timeout: 15_000 });

    // The call lives in the shell, so the move to /map keeps the same socket.
    const bar = page.getByRole("region", { name: "Voice chat with Ripley" });
    await expect(bar).toBeVisible();
    say(socket, "Here's Soho on the map.");
    await expect(bar).toContainText("Here's Soho on the map.");
    await expect(bar.getByRole("status")).toHaveText(/Ripley is (listening|talking)/);
    expect(socketClosed).toBe(false);
    expect(releases).toBe(0);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible();
    await expectMapLoadingFrameReleased(page);
    await page.screenshot({ path: `${SHOTS}/${width}-${theme}-5-map-voice-bar.png` });

    await bar.getByRole("button", { name: "End", exact: true }).click();
    await expect(bar).toBeHidden();
    await expect.poll(() => socketClosed).toBe(true);
    await expect.poll(() => releases).toBe(1);
  });
}

type PalPicksProbe = { sequence: number; scrim: boolean; speaking: number | null; picks: { number: number; venueId: string; x: number; y: number }[] };
type CameraReading = { center: [number, number]; zoom: number; moving: boolean; settling: boolean };

for (const width of [390, 1440]) {
  test(`${width}px: a grounded voice answer draws numbered picks on the main map and frames them, unless a finger holds the map`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const socket = await openLiveVoice(page);
    const response = await page.request.post("/api/pub-pal/chat", { data: { query: "Find me four pubs in Soho and show them on the map." } });
    expect(response.ok()).toBe(true);
    const answer = await response.json() as { answer: string; cards: { venueId: string; title: string; provenance: { label: string } }[] };
    expect(answer.cards).toHaveLength(4);
    const index = JSON.parse(await readFile("public/data/venues_slim.json", "utf8")) as { rows: { id: string; lat: number; lng: number }[] };
    const deliver = (cards: unknown[]) => {
      eventId += 1;
      const request = { tool_name: "search_venues", tool_call_id: `search_venues-${eventId}`, tool_type: "webhook", event_id: eventId };
      socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
      socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
        ...request, is_error: false, is_called: true,
        full_tool_result: JSON.stringify({ requestedTool: "search_venues", result: { ok: true, tool: "search_venues", answerHint: answer.answer, cards,
          data: { venues: index.rows.filter((venue) => answer.cards.some((card) => card.venueId === venue.id)).map(({ id, lat, lng }) => ({ id, lat, lng })) },
        } }),
      } }));
    };

    hear(socket, "Show me the map");
    await expect(page).toHaveURL(/\/map(?:\?|$)/, { timeout: 15_000 });
    await expectMapLoadingFrameReleased(page);
    await expect.poll(() => page.evaluate(() => Boolean(
      (window as unknown as { __pubmaxMapCamera?: unknown }).__pubmaxMapCamera,
    ))).toBe(true);
    const camera = () => page.evaluate(() => (window as unknown as { __pubmaxMapCamera: { read: () => CameraReading } }).__pubmaxMapCamera.read());
    const picks = () => page.evaluate(() => (window as unknown as { __pubmaxPalPicks?: () => PalPicksProbe }).__pubmaxPalPicks?.() ?? null);
    await expect.poll(async () => { const reading = await camera(); return !reading.moving && !reading.settling; }, { timeout: 20_000 }).toBe(true);
    const before = await camera();

    deliver(answer.cards);
    await expect.poll(async () => (await picks())?.picks.map((pick) => pick.number), { timeout: 5_000 }).toEqual([1, 2, 3, 4]);
    const painted = (await picks())!;
    expect(painted.scrim).toBe(true);
    expect(painted.picks.map((pick) => pick.venueId)).toEqual(answer.cards.map((card) => card.venueId));
    const latency = await page.evaluate(() => {
      const grounded = performance.getEntriesByName("pubmax:pal-picks-grounded").at(-1);
      const shown = performance.getEntriesByName("pubmax:pal-picks-painted").at(-1);
      return grounded && shown ? shown.startTime - grounded.startTime : null;
    });
    test.info().annotations.push({ type: "result-to-picks-ms", description: String(latency) });
    test.info().annotations.push({ type: "result-to-picks-target-ms", description: "300" });
    expect(latency).not.toBeNull();
    expect(latency!).toBeGreaterThanOrEqual(0);
    expect(latency!, "300 ms target, with the approved 600 ms timing ceiling").toBeLessThanOrEqual(600);

    // The `pal` intent frames the picks: the camera moves off the opening view
    // and every pick ends up inside the phone's viewport.
    await expect.poll(async () => { const reading = await camera(); return !reading.moving && !reading.settling; }, { timeout: 10_000 }).toBe(true);
    const framed = await camera();
    expect(framed.zoom).toBeGreaterThan(before.zoom);
    for (const pick of (await picks())!.picks) {
      expect(pick.x).toBeGreaterThan(0);
      expect(pick.x).toBeLessThan(width);
      expect(pick.y).toBeGreaterThan(0);
      expect(pick.y).toBeLessThan(844);
    }
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${width}-pal-picks-on-map.png` });

    if (width === 1440) {
      const canvas = page.locator(".mapCanvasWrap canvas").first();
      await canvas.press("Shift+-");
      await expect.poll(async () => (await camera()).zoom).toBeLessThan(framed.zoom - 1.9);
      await canvas.press("Shift+-");
      await expect.poll(async () => { const reading = await camera(); return !reading.moving && !reading.settling; }).toBe(true);
      await canvas.press("Shift+-");
      await expect(page.locator(".donut-cluster-marker").first()).toBeVisible();
      await expect.poll(async () => { const reading = await camera(); return !reading.moving && !reading.settling; }).toBe(true);
      await expect(page.locator(".donut-cluster-marker").first()).toHaveCSS("opacity", "0.45");
    }

    // A finger on the glass keeps the map: a new answer repaints the picks but
    // its framing stands down (lib/mapGestureGuard.ts).
    const canvas = page.locator(".mapCanvasWrap canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 3 + 30, { steps: 5 });
    const held = await camera();
    deliver(answer.cards.slice(0, 2));
    await expect.poll(async () => (await picks())?.picks.length, { timeout: 5_000 }).toBe(2);
    await page.mouse.up();
    const after = await camera();
    expect(after.zoom).toBeCloseTo(held.zoom, 5);
    expect(after.center[0]).toBeCloseTo(held.center[0], 5);
    expect(after.center[1]).toBeCloseTo(held.center[1], 5);

    deliver([]);
    await expect.poll(async () => (await picks())?.picks.length).toBe(0);
    expect((await picks())?.scrim).toBe(false);
    await expect(page.locator(".palPicksActive")).toHaveCount(0);
    deliver(answer.cards);
    await expect.poll(async () => (await picks())?.picks.length).toBe(4);

    // The pick the Pal names pulses as its name plays, with its price card.
    // The camera keeps the answer's framing, and talking over the Pal stops it.
    const { sequence } = (await picks())!;
    const named = answer.cards[1]!;
    const card = page.locator(".palVoiceBarPick");
    sayAligned(socket, `Second, ${named.title}, on the map now.`);
    await expect.poll(async () => (await picks())?.speaking, { timeout: 5_000 }).toBe(2);
    expect((await picks())!.sequence).toBe(sequence);
    await expect(card).toContainText(named.title);
    await expect(card).toContainText(named.provenance.label);
    await page.screenshot({ path: `${SHOTS}/${width}-pal-pick-named.png` });
    const namedMarker = page.getByRole("button", { name: `2. ${named.title}`, exact: true });
    await namedMarker.evaluate((button) => button.getAnimations().forEach((animation) => animation.finish()));
    sayAligned(socket, `Again, ${named.title}.`);
    await expect.poll(() => namedMarker.evaluate((button) =>
      button.getAnimations().some((animation) => animation.playState === "running"),
    )).toBe(true);
    expect((await picks())!.sequence).toBe(sequence);
    eventId += 1;
    socket.send(JSON.stringify({ type: "interruption", interruption_event: { event_id: eventId } }));
    await expect.poll(async () => (await picks())?.speaking).toBeNull();
    await expect(card).toHaveCount(0);

    // A tap on a pick opens its venue sheet, and the call carries on.
    const [first] = (await picks())!.picks;
    await page.getByRole("button", { name: `1. ${answer.cards[0]!.title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`sel=${encodeURIComponent(first!.venueId)}`));
    await expect(page.getByRole("region", { name: "Voice chat with Ripley" }).getByRole("status")).toHaveText(/Ripley is (listening|talking)/);
  });
}

test("a cold /map defers the voice transport chunk until the chip tap", async ({ page }) => {
  // The runtime WebSocket access identifies the transport chunk independently
  // of its filename or source. A cold download of that chunk fails this check.
  await releaseDeferredShell(page);
  const { opened } = await preparePalAccount(page, false, undefined, false, false, true);
  const scripts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.add(request.url());
  });
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  const chip = page.getByRole("button", { name: "Talk to Ripley, your Pub Pal", exact: true });
  await expect(chip).toBeVisible();
  const beforeTap = [...scripts];
  await page.evaluate(() => {
    const surface = window as unknown as { voiceSocketStacks: string[] };
    surface.voiceSocketStacks = [];
    const transport = window.WebSocket;
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      get() {
        surface.voiceSocketStacks.push(new Error().stack ?? "");
        return transport;
      },
    });
  });
  await page.screenshot({ path: `${SHOTS}/cold-map.png` });
  await chip.click();
  await opened;
  await expect(page.locator(".palVoiceBar").getByRole("status")).toHaveText(/Ripley is (listening|talking)/);
  const stacks = await page.evaluate(() => (window as unknown as { voiceSocketStacks: string[] }).voiceSocketStacks);
  await test.info().attach("voice-transport-stacks", {
    body: JSON.stringify(stacks, null, 2), contentType: "application/json",
  });
  const caller = stacks.flatMap((stack) => stack.split("\n").slice(2))
    .map((frame) => frame.match(/https?:\/\/[^\s)]+/)?.[0]?.replace(/:\d+:\d+$/, ""))
    .find(Boolean);
  expect(caller, "The live voice startup must identify its transport script").toBeTruthy();
  expect(beforeTap).not.toContain(caller);
  expect([...scripts]).toContain(caller);
  await test.info().attach("cold-map-network", {
    body: JSON.stringify({ beforeTap, transportCaller: caller, stacks }, null, 2), contentType: "application/json",
  });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(chip).toBeVisible();
});

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


test.describe("repeated voice search", () => {
  test.use({ hasTouch: true });
for (const detailFirst of [true, false]) {
  test(`repeated voice searches replace old recommendations and preserve independent detail (${detailFirst})`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 1000 });
    const socket = await openLiveVoice(page);
    hear(socket, "Find four pubs in Soho, then four near Bank.");
    const results = [];
    for (const query of ["Find four pubs in Soho", "Find four pubs near Bank"]) {
      const response = await page.request.post("/api/pub-pal/chat", { data: { query } });
      expect(response.ok()).toBe(true);
      const answer = await response.json();
      expect(answer.cards).toHaveLength(4);
      results.push(answer.cards);
    }
    const [soho, bank] = results;
    expect(bank.map((card: { venueId: string }) => card.venueId)).not.toEqual(soho.map((card: { venueId: string }) => card.venueId));
    const request = (tool: string, id: string) => {
      const event = { tool_name: tool, tool_call_id: id, tool_type: "webhook", event_id: eventId };
      socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: event }));
      return event;
    };
    const complete = (event: ReturnType<typeof request>, cards: unknown[], canonical = event.tool_name) => socket.send(JSON.stringify({
      type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
        ...event, is_error: false, is_called: true,
        full_tool_result: JSON.stringify({ requestedTool: event.tool_name, result: { ok: true, tool: canonical, answerHint: "Recorded results.", cards } }),
      },
    }));
    const first = request("search_venues", "first-search");
    complete(first, soho);
    const list = page.getByRole("list", { name: "Pubs from the voice answer" });
    await expect(list.locator("li")).toHaveCount(4);
    const menu = request("venue_drinks", "menu-old-pub");
    const detail = [{ ...soho[0], key: "menu-detail", title: "Menu at the earlier pub" }];
    if (detailFirst) complete(menu, detail);
    const lateOld = request("search_venues", "late-old-search");
    const latest = request("search_venues", "latest-search");
    complete(latest, bank);
    if (!detailFirst) complete(menu, detail);
    complete(lateOld, soho);
    complete(latest, bank);
    complete(request("city_status", "status"), [{ key: "status", title: "Tube status", note: "No severe delays." }]);
    await expect(list.locator("li")).toHaveCount(5);
    await expect(list.getByRole("link", { name: "Menu at the earlier pub", exact: true })).toHaveCount(1);
    for (const card of bank) await expect(list.getByRole("link", { name: card.title, exact: true })).toHaveCount(1);
    const map = page.getByRole("region", { name: "4 pubs on the map", exact: true });
    await map.scrollIntoViewIfNeeded();
    await expect(map.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
    const pins = map.locator(".palChatMapPin");
    await expect(pins).toHaveCount(4);
    expect(await pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")))).toEqual(bank.map((card: { venueId: string }) => card.venueId));
    const canvas = map.locator("canvas");
    const identity = await canvas.elementHandle();
    const before = await map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 25, box!.y + box!.height / 2 + 15, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).not.toEqual(before);
    // Compare the next result only after the reader's pan stops moving the pins.
    let previous = "";
    let settled = 0;
    await expect.poll(async () => {
      const positions = JSON.stringify(await map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform)));
      settled = positions === previous ? settled + 1 : 0;
      previous = positions;
      return settled;
    }, { intervals: [100] }).toBeGreaterThanOrEqual(3);
    const panned = await map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
    complete(request("journey", "independent-journey"), [{ ...soho[0], key: "journey-detail", title: "Journey from the earlier pub" }]);
    await expect(list.getByRole("link", { name: "Journey from the earlier pub", exact: true })).toBeVisible();
    expect(await canvas.evaluate((node, old) => node === old, identity)).toBe(true);
    expect(await map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(panned);
    await expect(pins).toHaveCount(4);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await map.screenshot({ path: testInfo.outputPath(`${width}-choices-before-map-followups.png`) });
      for (const spoken of [true, false]) {
        await map.scrollIntoViewIfNeeded();
        for (const pin of await pins.all()) await pin.tap({ trial: true });
        const camera = await map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
        const thanks = page.getByRole("log", { name: "Voice chat transcript" }).locator(".palVoiceLine--you").filter({ hasText: "Thanks" });
        const previousThanks = await thanks.count();
        if (spoken) hear(socket, "Thanks");
        else {
          await page.getByPlaceholder("Or type the night you want…", { exact: true }).fill("Thanks");
          await page.getByRole("button", { name: "Send message", exact: true }).click();
        }
        await expect(thanks).toHaveCount(previousThanks + 1);
        say(socket, "You are welcome.");
        await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("You are welcome.");
        for (const followup of ["Show those pubs on the map", "Show me the map"]) {
          if (spoken) hear(socket, followup);
          else {
            await page.getByPlaceholder("Or type the night you want…", { exact: true }).fill(followup);
            await page.getByRole("button", { name: "Send message", exact: true }).click();
          }
          await expect(map).toBeFocused();
          await expect(page).toHaveURL(/\/pal$/);
          expect(await canvas.evaluate((node, old) => node === old, identity)).toBe(true);
          expect(await map.locator(".palChatMapAnchor").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(camera);
          expect(await pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")))).toEqual(bank.map((card: { venueId: string }) => card.venueId));
          await map.screenshot({ path: testInfo.outputPath(`${width}-${spoken ? "spoken" : "typed"}-${followup}-map-followup.png`) });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    complete(request("search_venues", "changed-after-pan"), soho);
    await expect.poll(() => pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")))).toEqual(soho.map((card: { venueId: string }) => card.venueId));
    await expect(map.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
    for (const pin of await pins.all()) await pin.tap({ trial: true });
    const alias = request("venue_prices", "alias-search");
    complete(alias, bank, "search_venues");
    await expect.poll(() => pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")))).toEqual(bank.map((card: { venueId: string }) => card.venueId));
    const oldAlias = request("venue_prices", "late-alias-search");
    const newestSearch = request("search_venues", "newest-search");
    complete(newestSearch, soho);
    complete(oldAlias, bank, "search_venues");
    await expect.poll(() => pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")))).toEqual(soho.map((card: { venueId: string }) => card.venueId));
    await expect(list.locator("li")).toHaveCount(6);
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(pins).toHaveCount(4);
    await page.getByRole("button", { name: "Start voice chat", exact: true }).click();
    await expect(list).toHaveCount(0);
  });
}

});

test("the real SDK carries a grounded returning opening into a fresh voice session", async ({ page }) => {
  const greeting = 'Hi, I\'m Ripley. You told me: "I visited The Crown on 10 October 2026, drank Camden Hells and spent £26.80 in total." Something similar tonight?';
  await openLiveVoice(page, false, greeting);
  await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText(greeting);
});

for (const action of ["mute", "delete", "leave", "sign out"] as const) {
  test(`voice boundary: ${action} stops the real SDK socket and microphone`, async ({ page }) => {
    await page.setViewportSize({ width: action === "sign out" ? 1440 : 390, height: 844 });
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const tracks: MediaStreamTrack[] = [];
      Object.assign(window, { voiceTestTracks: tracks });
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        tracks.push(...stream.getTracks());
        return stream;
      };
    });
    let releases = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/pub-pal/voice-token" && request.method() === "POST" && request.postDataJSON()?.action === "release") releases += 1;
    });
    const socket = await openLiveVoice(page);
    let closed = false;
    socket.onClose(() => { closed = true; });
    if (action === "mute") await page.getByRole("button", { name: "Voice allowed Tap to mute everywhere", exact: true }).click();
    if (action === "delete") {
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Delete Ripley Deletes the Pal and every confirmed memory", exact: true }).click();
    }
    if (action === "leave") await page.getByRole("link", { name: "Plan with Ripley", exact: true }).click();
    if (action === "sign out") {
      hear(socket, "Show me the map");
      await expect(page).toHaveURL(/\/map(?:\?|$)/);
      await page.getByRole("button", { name: /Account options/ }).first().click();
      await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();
    }
    await expect.poll(() => closed).toBe(true);
    await expect.poll(() => releases).toBe(1);
    await expect.poll(() => page.evaluate(() => {
      const tracks = (window as unknown as { voiceTestTracks: MediaStreamTrack[] }).voiceTestTracks;
      return tracks.length > 0 && tracks.every(track => track.readyState === "ended");
    })).toBe(true);
    await expect(page.locator(".palVoiceBar")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/boundary-${action}.png` });
    await test.info().attach("voice-cleanup", { body: JSON.stringify({ action, closed, releases, tracks: await page.evaluate(() => (window as unknown as { voiceTestTracks: MediaStreamTrack[] }).voiceTestTracks.map(track => track.readyState)) }), contentType: "application/json" });
  });
}

test("hidden Pal: the map controls remain tappable above live and interrupted voice bars", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "dark");
  const socket = await openLiveVoice(page, false, undefined, true);
  hear(socket, "Show me the map");
  await expect(page).toHaveURL(/\/map(?:\?|$)/);
  await expectMapLoadingFrameReleased(page);
  const bar = page.getByRole("region", { name: "Voice chat with Ripley" });
  const near = page.getByRole("button", { name: "Near me", exact: true });
  const check = async (state: string) => {
    await expect(bar).toBeVisible();
    await expect(near).toBeVisible();
    await expect(near).toBeEnabled();
    await expect.poll(async () => {
      const a = await bar.boundingBox();
      const b = await near.boundingBox();
      return !!a && !!b && b.y + b.height <= a.y;
    }).toBe(true);
    await near.click({ trial: true });
    await page.screenshot({ path: `${SHOTS}/hidden-pal-${state}.png` });
  };
  say(socket, "Here is your map. This longer message checks the space used by a two-line caption while the call remains connected.");
  await expect(bar).toContainText("two-line caption");
  await check("live");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(bar.getByRole("status")).toContainText("hung up");
  await check("interrupted");
  await bar.getByRole("button", { name: "Close voice chat", exact: true }).click();
  await expect(bar).toBeHidden();
});

test("returning to Pal keeps the transcript and socket, then mute ends the call", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const socket = await openLiveVoice(page);
  let closed = false;
  socket.onClose(() => { closed = true; });
  say(socket, "We will keep this conversation when you return.");
  hear(socket, "Show me the map");
  await expect(page).toHaveURL(/\/map(?:\?|$)/);
  await expect(page.locator(".palVoiceBar")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/pal$/);
  const log = page.getByRole("log", { name: "Voice chat transcript" });
  await expect(log).toContainText("We will keep this conversation when you return.");
  say(socket, "Still on the original call.");
  await expect(log).toContainText("Still on the original call.");
  expect(closed).toBe(false);
  await page.screenshot({ path: `${SHOTS}/round-trip-transcript.png` });
  await page.getByRole("button", { name: "Voice allowed Tap to mute everywhere", exact: true }).click();
  await expect.poll(() => closed).toBe(true);
});

for (const pending of ["plan read", "redirect timer"] as const) {
  test(`manual pub selection cancels a pending ${pending}, preserves voice, and keeps End usable`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const socket = await openLiveVoice(page);
    let closed = false;
    socket.onClose(() => { closed = true; });
    hear(socket, "Find four pubs in Soho");
    const response = await page.request.post("/api/pub-pal/chat", { data: { query: "Find four pubs in Soho" } });
    expect(response.ok()).toBe(true);
    const answer = await response.json();
    expect(answer.cards).toHaveLength(4);
    const request = { tool_name: "search_venues", tool_call_id: "manual-selection", tool_type: "webhook", event_id: ++eventId };
    socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
    socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
      ...request, is_error: false, is_called: true,
      full_tool_result: JSON.stringify({ requestedTool: "search_venues", result: { ok: true, tool: "search_venues", answerHint: "Recorded results.", cards: answer.cards } }),
    } }));
    const list = page.getByRole("list", { name: "Pubs from the voice answer" });
    await expect(list.locator("li")).toHaveCount(4);
    let finishRead!: () => void;
    const holdRead = new Promise<void>(resolve => { finishRead = resolve; });
    let readStarted!: () => void;
    const started = new Promise<void>(resolve => { readStarted = resolve; });
    const planId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await page.route(`**/api/plans/${planId}`, async route => {
      readStarted();
      await holdRead;
      await route.fulfill({ json: { stops: [
        { venueId: answer.cards[0].venueId, venueName: answer.cards[0].title },
        { venueId: answer.cards[1].venueId, venueName: answer.cards[1].title },
      ] } });
    });
    if (pending === "plan read") {
      await page.evaluate(({ planId, ownerId }) => localStorage.setItem("pubmax_active_plan", JSON.stringify({ version: 1, id: planId, ownerId, startTime: new Date().toISOString(), stopIndex: 0 })), { planId, ownerId: ACCOUNTS.A.id });
      hear(socket, "What's next?");
      await started;
    } else {
      await page.clock.install();
      hear(socket, "Show me the map");
      await expect(page.locator(".palVoiceMapCard")).toContainText("Opening the map");
    }
    await list.getByRole("link", { name: answer.cards[0].title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/map\\?sel=${answer.cards[0].venueId}$`));
    await expect(page.locator(".palVoiceBar")).toBeVisible();
    if (pending === "plan read") {
      await page.clock.install();
      const completed = page.waitForResponse(`**/api/plans/${planId}`);
      finishRead();
      const reply = await completed;
      await reply.finished();
    } else finishRead();
    await page.clock.fastForward(3_000);
    await expect(page).toHaveURL(new RegExp(`/map\\?sel=${answer.cards[0].venueId}$`));
    say(socket, "Your manual choice is still open.");
    await expect(page.locator(".palVoiceBar")).toContainText("Your manual choice is still open.");
    expect(closed).toBe(false);
    await test.info().attach("manual-navigation", { body: JSON.stringify({ pending, url: page.url(), socketClosed: closed, transcript: await page.locator(".palVoiceBar").innerText() }), contentType: "application/json" });
    await expect(page.getByRole("dialog", { name: "Pub detail", exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/cancel-${pending.replace(" ", "-")}.png` });
    const end = page.getByRole("button", { name: "End", exact: true });
    const hit = await end.evaluate(button => {
      const box = button.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { reachable: target === button || button.contains(target), inertAncestor: button.closest("[inert]")?.outerHTML.slice(0, 220), interceptedBy: target?.outerHTML.slice(0, 200) };
    });
    await test.info().attach("voice-end-hit-target", { body: JSON.stringify(hit), contentType: "application/json" });
    await test.step("End remains usable beside pub details", async () => { expect(hit.reachable).toBe(true); });
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect.poll(() => closed).toBe(true);
  });
}

test("an unavailable voice deployment offers writing without downloading the SDK", async ({ page }) => {
  const scripts: Promise<{ url: string; sdk: boolean }>[] = [];
  page.on("response", response => {
    if (response.request().resourceType() === "script") scripts.push(response.text().then(body => ({ url: response.url(), sdk: body.includes("conversation_initiation_client_data") })));
  });
  let answerProbe!: () => void;
  const held = new Promise<void>(resolve => { answerProbe = resolve; });
  const timestamp = new Date().toISOString();
  await page.route("**/api/pub-pal", route => route.fulfill({ json: { pal: {
    ...DEFAULT_PAL_DRAFT, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    name: "Ripley", adultAttestedAt: timestamp, muted: false, hidden: false, masteryPoints: 0,
    createdAt: timestamp, updatedAt: timestamp,
  }, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", route => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/voice-token", async route => {
    await held;
    await route.fulfill({ json: { available: false } });
  });
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.goto("/pal");
  await expect(page.getByRole("status").filter({ hasText: "Checking whether voice is on" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toHaveCount(0);
  answerProbe();
  await expect(page.locator(".palVoice--offline")).toContainText("Voice is unavailable just now");
  await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/voice-unavailable.png` });
  const loaded = await Promise.all(scripts);
  expect(loaded.filter(script => script.sdk)).toEqual([]);
  await test.info().attach("unavailable-voice-network", { body: JSON.stringify(loaded, null, 2), contentType: "application/json" });
  await page.locator(".palVoice--offline").getByRole("link", { name: "Ask in writing", exact: true }).click();
  await expect(page).toHaveURL(/\/pal\/chat$/);
});

// The acceptance oracle is step 6: playback selects the named pick, preserves
// its price receipt, repeats each occurrence, and stops on interruption.
for (const [width, theme, reducedMotion] of [
  [390, "light", "no-preference"],
  [768, "dark", "reduce"],
  [1440, "dark", "no-preference"],
] as const) {
  test(`step 6 playback boundaries at ${width}px with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await storeThemeChoice(page, theme);
    await page.emulateMedia({ reducedMotion });
    const socket = await openLiveVoice(page);
    const venues = [
      { id: "venue-1t8siin", lat: 51.5139, lng: -0.132474 },
      { id: "venue-1ozggok", lat: 51.51118, lng: -0.13631 },
    ];
    // Disposable provider receipts, never written to a server or shared store.
    const cards = ["The Crown & Two Chairmen", "The Crown"].map((title, index) => ({
      key: `step6-${index}`, venueId: venues[index]!.id, title, place: "Soho",
      note: "Disposable browser fixture", price: index === 0 ? 5.20 : 6.40,
      provenance: { kind: "directory", label: "Disposable menu fixture. Recorded 10 Nov 2026.", url: "https://example.test/menu" },
    }));
    const deliver = () => {
      const request = { tool_name: "search_venues", tool_call_id: `step6-${++eventId}`, tool_type: "webhook", event_id: eventId };
      socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
      socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
        ...request, is_error: false, is_called: true,
        full_tool_result: JSON.stringify({ requestedTool: "search_venues", result: {
          ok: true, tool: "search_venues", answerHint: "Two disposable test recommendations.", cards, data: { venues },
        } }),
      } }));
    };
    const startReply = (text: string) => {
      const id = ++eventId;
      socket.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: text, event_id: id } }));
      return id;
    };
    const audio = (id: number, text: string, stepMs = 10) => {
      const chars = [...text];
      socket.send(JSON.stringify({ type: "audio", audio_event: {
        audio_base_64: toneChunk(), event_id: id,
        alignment: { chars, char_start_times_ms: chars.map((_, i) => i * stepMs), char_durations_ms: chars.map(() => stepMs) },
      } }));
    };
    const marker = (number: number) => page.getByRole("button", { name: `${number}. ${cards[number - 1]!.title}`, exact: true });
    const focused = () => page.locator(".palPick[data-speaking]");
    const card = page.locator(".palVoiceBarPick");
    if (width === 390) {
      deliver();
      const opening = startReply("The Crown and Two Chairmen.");
      audio(opening, "The Crown and Two Chairmen.");
      const status = page.getByRole("status").filter({ hasText: /Pal is (talking|listening)/ });
      await expect(status).toContainText("talking");
      await expect(status).toContainText("listening");
      await page.getByRole("list", { name: "Pubs from the voice answer" }).getByRole("link", { name: cards[0]!.title, exact: true }).click();
      await expect(page).toHaveURL(/\/map(?:\?|$)/);
      await expect(marker(1)).toHaveAttribute("data-speaking", "");
      await expect(card).toContainText("£5.20");
      await page.getByRole("button", { name: "Close pub detail", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Pub detail", exact: true })).toBeHidden();
      await expect(card).toBeVisible();
      await card.click({ trial: true });

    } else {
      hear(socket, "Show me the map");
      await expect(page).toHaveURL(/\/map(?:\?|$)/);
      deliver();
    }
    await expectMapLoadingFrameReleased(page);
    if (width === 390) {
      await expect(marker(1)).toHaveAttribute("data-speaking", "");
      await page.screenshot({ path: `${SHOTS}/step6-390-focused-before-map-install.png` });
      socket.send(JSON.stringify({ type: "interruption", interruption_event: { event_id: ++eventId } }));
      await expect(focused()).toHaveCount(0);
    }
    await expect(marker(1)).toBeVisible();
    await expect(marker(2)).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const map = (window as unknown as { __pubmaxMapCamera?: { read: () => CameraReading } }).__pubmaxMapCamera?.read();
      return map && !map.moving && !map.settling;
    })).toBe(true);
    const camera = await page.evaluate(() => (window as unknown as { __pubmaxMapCamera: { read: () => CameraReading } }).__pubmaxMapCamera.read());

    // Receiving text alone cannot trigger the visual cue before audio plays.
    const id = startReply("The Crown and Two Chairmen. The Crown. The Crown and Two Chairmen.");
    await expect(page.locator(".palVoiceBarCaption")).toContainText("Two Chairmen");
    await expect(focused()).toHaveCount(0);
    audio(id, "The Crown and Two Chairmen. ");
    await expect(marker(1)).toHaveAttribute("data-speaking", "");
    await expect(marker(2)).not.toHaveAttribute("data-speaking", "");
    await expect(card).toContainText("The Crown & Two Chairmen");
    await expect(card).toContainText("£5.20");
    await expect(card).toContainText("Disposable menu fixture. Recorded 10 Nov 2026.");
    await expect(card.getByRole("link")).toHaveAttribute("href", "https://example.test/menu");
    const style = await marker(1).evaluate(button => ({ animation: getComputedStyle(button).animationName, ring: getComputedStyle(button).boxShadow }));
    expect(style.animation).toBe(reducedMotion === "reduce" ? "none" : "palPickPulse");
    expect(style.ring).not.toBe("none");
    await page.screenshot({ path: `${SHOTS}/step6-${width}-${theme}-${reducedMotion}.png` });

    // Every repeated occurrence in one reply must replace the previous card.
    audio(id, "The Crown. ");
    await expect(marker(2)).toHaveAttribute("data-speaking", "");
    await expect(card).toContainText("£6.40");
    audio(id, "The Crown and Two Chairmen. ");
    await expect(marker(1)).toHaveAttribute("data-speaking", "");
    await expect(card).toContainText("£5.20");
    if (reducedMotion === "no-preference") {
      await marker(1).evaluate(button => button.getAnimations().forEach(animation => animation.finish()));
      audio(id, "The Crown and Two Chairmen. ");
      await expect.poll(() => marker(1).evaluate(button => button.getAnimations().some(animation => animation.playState === "running"))).toBe(true);
    }
    const after = await page.evaluate(() => (window as unknown as { __pubmaxMapCamera: { read: () => CameraReading } }).__pubmaxMapCamera.read());
    expect(after.center).toEqual(camera.center);
    expect(after.zoom).toBe(camera.zoom);

    // A later chunk corrects a shorter reference at the same spoken position.
    const split = startReply("The Crown and Two Chairmen.");
    audio(split, "The Crown ");
    await expect(marker(2)).toHaveAttribute("data-speaking", "");
    audio(split, "and Two Chairmen.");
    await expect(marker(1)).toHaveAttribute("data-speaking", "");
    await expect(card).toContainText("The Crown & Two Chairmen");
    await page.screenshot({ path: `${SHOTS}/step6-${width}-split-corrected.png` });

    // Interrupt while a later mention in the current audio chunk is pending.
    const pending = startReply("The Crown. Then The Crown and Two Chairmen.");
    audio(pending, "The Crown. Then The Crown and Two Chairmen.", 30);
    await page.waitForFunction(() => document.querySelector('.palPick[data-speaking]')?.getAttribute("aria-label") === "2. The Crown");
    socket.send(JSON.stringify({ type: "interruption", interruption_event: { event_id: ++eventId } }));
    await expect(focused()).toHaveCount(0);
    await expect(card).toHaveCount(0);
    // A stale aligned audio event must be discarded by the real SDK.
    audio(pending, "The Crown and Two Chairmen.");
    const recovery = startReply("We can find somewhere else.");
    audio(recovery, "We can find somewhere else.");
    await expect(page.locator(".palVoiceBar").getByRole("status")).toContainText("talking");
    await expect(page.locator(".palVoiceBar").getByRole("status")).toContainText("listening");
    await expect(focused()).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/step6-${width}-interrupted.png` });
    await testInfo.attach("step6-provider-and-rendered-state", { body: JSON.stringify({ browserVersion: page.context().browser()?.version(), width, theme, reducedMotion, cards, style, camera, after, interruptedFocus: await focused().count() }), contentType: "application/json" });
    await page.getByRole("button", { name: "End", exact: true }).click();
  });
}

// Step 7: the agent's map client tools move only the view. A pick number the
// map does not show goes back to the agent as a contextual update.
for (const [width, theme] of [[390, "light"], [1440, "dark"]] as const) {
  test(`${width}px ${theme}: the agent's map tools fly to an area, focus, open and clear picks, and refuse a pick not on the map`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await storeThemeChoice(page, theme);
    const socket = await openLiveVoice(page);
    const sent: { type?: string; text?: string; tool_call_id?: string; is_error?: boolean }[] = [];
    socket.onMessage((message) => { sent.push(JSON.parse(String(message))); });
    const venues = [
      { id: "venue-1t8siin", lat: 51.5139, lng: -0.132474 },
      { id: "venue-1ozggok", lat: 51.51118, lng: -0.13631 },
    ];
    // Disposable provider receipts, never written to a server or shared store.
    const cards = ["The Crown & Two Chairmen", "The Crown"].map((title, index) => ({
      key: `step7-${index}`, venueId: venues[index]!.id, title, place: "Soho",
      note: "Disposable browser fixture", price: index === 0 ? 5.20 : 6.40,
      provenance: { kind: "directory", label: "Disposable menu fixture. Recorded 10 Nov 2026.", url: "https://example.test/menu" },
    }));
    const request = { tool_name: "search_venues", tool_call_id: `step7-${++eventId}`, tool_type: "webhook", event_id: eventId };
    socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
    socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
      ...request, is_error: false, is_called: true,
      full_tool_result: JSON.stringify({ requestedTool: "search_venues", result: {
        ok: true, tool: "search_venues", answerHint: "Two disposable test recommendations.", cards, data: { venues },
      } }),
    } }));
    const call = (tool_name: string, parameters: Record<string, unknown>) => {
      const id = ++eventId;
      const tool_call_id = `${tool_name}-${id}`;
      socket.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name, tool_call_id, parameters, event_id: id } }));
      return tool_call_id;
    };
    const answered = (id: string) => expect.poll(() => sent.find((event) => event.type === "client_tool_result" && event.tool_call_id === id)?.is_error).toBe(false);
    const camera = () => page.evaluate(() => (window as unknown as { __pubmaxMapCamera: { read: () => CameraReading } }).__pubmaxMapCamera.read());
    const settled = () => expect.poll(async () => {
      const reading = await page.evaluate(() => (window as unknown as { __pubmaxMapCamera?: { read: () => CameraReading } }).__pubmaxMapCamera?.read());
      return Boolean(reading && !reading.moving && !reading.settling);
    }, { timeout: 20_000 }).toBe(true);
    const picks = () => page.evaluate(() => (window as unknown as { __pubmaxPalPicks?: () => PalPicksProbe }).__pubmaxPalPicks?.() ?? null);

    // From /pal, "take me to Camden" opens the map framed on Camden, not on the picks.
    await answered(call("map_fly_to_area", { area: "Camden" }));
    await expect(page).toHaveURL(/\/map(?:\?|$)/, { timeout: 15_000 });
    await expectMapLoadingFrameReleased(page);
    await expect.poll(async () => (await picks())?.picks.length, { timeout: 10_000 }).toBe(2);
    await settled();
    // The fit pads for the top bar and the voice bar, so the centre sits near
    // Camden's (51.539, -0.143), not on it, and well away from the Soho picks.
    const camden = await camera();
    expect(Math.abs(camden.center[1] - 51.539)).toBeLessThan(0.01);
    expect(Math.abs(camden.center[0] + 0.143)).toBeLessThan(0.01);
    await page.screenshot({ path: `${SHOTS}/step7-${width}-${theme}-fly-to-camden.png` });

    // "The second one": pick 2 pulses, its card shows, and the map moves to it.
    await answered(call("map_focus_pick", { number: 2 }));
    await expect(page.getByRole("button", { name: `2. ${cards[1]!.title}`, exact: true })).toHaveAttribute("data-speaking", "");
    await expect(page.locator(".palVoiceBarPick")).toContainText("£6.40");
    await settled();
    const focused = await camera();
    expect(focused.zoom).toBeGreaterThan(camden.zoom + 1);
    expect(Math.abs(focused.center[1] - venues[1]!.lat)).toBeLessThan(0.0015);
    expect(Math.abs(focused.center[0] - venues[1]!.lng)).toBeLessThan(0.0015);
    const second = (await picks())!.picks.find((pick) => pick.number === 2)!;
    expect(second.x).toBeGreaterThan(0);
    expect(second.x).toBeLessThan(width);
    expect(second.y).toBeGreaterThan(0);
    expect(second.y).toBeLessThan(844);
    await page.screenshot({ path: `${SHOTS}/step7-${width}-${theme}-focus-pick-2.png` });

    // A pick the map does not show changes nothing and tells the agent what it has.
    await answered(call("map_focus_pick", { number: 5 }));
    await expect.poll(() => sent.filter((event) => event.type === "contextual_update").map((event) => event.text))
      .toEqual(["The map could not show pick 5. 2 picks are on the map."]);
    expect((await picks())?.speaking).toBe(2);

    // "Open it": the pick's browse-only sheet opens and the call carries on.
    await answered(call("map_open_pick_sheet", { number: 1 }));
    await expect(page).toHaveURL(new RegExp(`sel=${venues[0]!.id}`), { timeout: 10_000 });
    await expect(page.getByRole("dialog").getByRole("heading", { name: cards[0]!.title })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/step7-${width}-${theme}-open-pick-1.png` });
    await page.getByRole("button", { name: "Close pub detail", exact: true }).click();

    // "Clear the map": the picks and the fade go.
    await answered(call("map_clear", {}));
    await expect.poll(async () => (await picks())?.picks.length).toBe(0);
    await expect(page.locator(".palPicksActive")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Voice chat with Ripley" }).getByRole("status")).toHaveText(/Ripley is (listening|talking)/);
    await testInfo.attach("step7-socket-from-browser", { body: JSON.stringify(sent.filter((event) => event.type !== "user_audio_chunk")), contentType: "application/json" });
    await page.getByRole("button", { name: "End", exact: true }).click();
  });
}

test("ending the call drops a map move the agent asked for that is still on its way", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const socket = await openLiveVoice(page);
  await page.clock.install();
  const id = ++eventId;
  socket.send(JSON.stringify({ type: "client_tool_call", client_tool_call: {
    tool_name: "map_fly_to_area", tool_call_id: `fly-${id}`, parameters: { area: "Camden" }, event_id: id,
  } }));
  // The map opens PAL_VOICE_MAP_DELAY_MS after the request. End the call inside that wait.
  await expect(page.locator(".palVoiceMapCard")).toContainText("Opening Camden");
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.clock.fastForward(3_000);
  await expect(page).toHaveURL(/\/pal$/);
  await expect(page.locator(".palVoiceMapCard")).toHaveCount(0);
});

test("a newer map tool call retires a map trip still on its way", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const socket = await openLiveVoice(page);
  const venues = [
    { id: "venue-1t8siin", lat: 51.5139, lng: -0.132474 },
    { id: "venue-1ozggok", lat: 51.51118, lng: -0.13631 },
  ];
  // Disposable provider receipts, never written to a server or shared store.
  const cards = ["The Crown & Two Chairmen", "The Crown"].map((title, index) => ({
    key: `retire-${index}`, venueId: venues[index]!.id, title, place: "Soho",
    note: "Disposable browser fixture", price: index === 0 ? 5.20 : 6.40,
    provenance: { kind: "directory", label: "Disposable menu fixture. Recorded 10 Nov 2026.", url: "https://example.test/menu" },
  }));
  const request = { tool_name: "search_venues", tool_call_id: `retire-${++eventId}`, tool_type: "webhook", event_id: eventId };
  socket.send(JSON.stringify({ type: "agent_tool_request", agent_tool_request: request }));
  socket.send(JSON.stringify({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: {
    ...request, is_error: false, is_called: true,
    full_tool_result: JSON.stringify({ requestedTool: "search_venues", result: {
      ok: true, tool: "search_venues", answerHint: "Two disposable test recommendations.", cards, data: { venues },
    } }),
  } }));
  await expect(page.getByRole("list", { name: "Pubs from the voice answer" })).toBeVisible();
  const call = (tool_name: string, parameters: Record<string, unknown>) => {
    const id = ++eventId;
    socket.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name, tool_call_id: `${tool_name}-${id}`, parameters, event_id: id } }));
  };
  await page.clock.install();
  call("map_open_pick_sheet", { number: 1 });
  await expect(page.locator(".palVoiceMapCard")).toContainText(`Opening ${cards[0]!.title}`);
  call("map_focus_pick", { number: 2 });
  await expect(page.locator(".palVoiceMapCard")).toContainText(`Showing ${cards[1]!.title}`);
  await page.clock.runFor(3_000);
  await page.clock.resume();
  await expect(page).toHaveURL(/\/map(?:\?|$)/);
  expect(new URL(page.url()).searchParams.get("sel")).toBeNull();
  await expect(page.getByRole("button", { name: `2. ${cards[1]!.title}`, exact: true })).toHaveAttribute("data-speaking", "");
});

// Step 9: on the map the Pal chip starts voice in place. Signed out it offers
// sign-in, and on another city's map it says voice talks about London.
// The chip rides the deferred shell, which waits 30 s on the web; tests release it at once.
const releaseDeferredShell = (page: Page) => page.addInitScript(() => localStorage.setItem("pubmax:e2e-defer-shell:v1", "now"));
for (const [width, theme] of [[390, "light"], [768, "dark"], [1440, "light"], [390, "dark"], [768, "light"], [1440, "dark"]] as const) {
  test(`${width}px ${theme}: a tap on the map's Pal chip starts voice in place and the chip becomes the voice bar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await storeThemeChoice(page, theme);
    await releaseDeferredShell(page);
    const { opened } = await preparePalAccount(page, false, undefined, false, false, true);
    await page.goto("/map");
    await expectMapLoadingFrameReleased(page);
    const chip = page.getByRole("button", { name: "Talk to Ripley, your Pub Pal", exact: true });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      const painted = await page.evaluate(() => {
        const probe = (window as unknown as {
          __pubmaxPaintedMapTapPoints?: (() => unknown[]) & { state?: () => { loaded: boolean } };
        }).__pubmaxPaintedMapTapPoints;
        return Boolean(probe?.state?.().loaded && probe().length > 0);
      });
      expect(painted).toBe(true);
    }).toPass();
    await expectMapLoadingFrameReleased(page);
    await page.screenshot({ path: `${SHOTS}/step9-${width}-${theme}-chip.png` });

    // Large text: the chip grows its type, not its box geometry, and still holds its words on screen.
    const fit = await chip.evaluate((element) => {
      for (const text of element.querySelectorAll<HTMLElement>("strong, small")) {
        const style = getComputedStyle(text);
        text.style.fontSize = `${parseFloat(style.fontSize) * 1.3}px`;
      }
      const box = element.getBoundingClientRect();
      const words = [...element.querySelectorAll("strong, small")].map((text) => {
        const range = document.createRange();
        range.selectNodeContents(text);
        return range.getBoundingClientRect();
      });
      return { box, words, viewport: window.innerWidth };
    });
    expect(fit.box.right).toBeLessThanOrEqual(fit.viewport + 1);
    expect(fit.box.left).toBeGreaterThanOrEqual(-1);
    expect(fit.words).toHaveLength(2);
    for (const words of fit.words) {
      expect(words.left).toBeGreaterThanOrEqual(fit.box.left - 1);
      expect(words.right).toBeLessThanOrEqual(fit.box.right + 1);
      expect(words.top).toBeGreaterThanOrEqual(fit.box.top - 1);
      expect(words.bottom).toBeLessThanOrEqual(fit.box.bottom + 1);
    }
    await page.screenshot({ path: `${SHOTS}/step9-${width}-${theme}-chip-large-text.png` });
    await chip.evaluate((element) => {
      for (const text of element.querySelectorAll<HTMLElement>("strong, small")) text.style.fontSize = "";
    });

    await expect(async () => {
      if (await chip.isVisible()) await chip.click({ timeout: 2_000 });
      await expect(page.locator(".palVoiceBar").getByRole("status")).toHaveText(/Ripley is (listening|talking)/, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const socket = await opened;
    await expect(page).toHaveURL(/\/map(?:\?|$)/);
    await expect(chip).toBeHidden();
    say(socket, "Hi. Where are you heading tonight?");
    await expect(page.locator(".palVoiceBar")).toContainText("Where are you heading tonight?");
    await page.screenshot({ path: `${SHOTS}/step9-${width}-${theme}-voice-in-place.png` });

    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(chip).toBeVisible();
  });
}

test("signed out, the map's Pal chip offers sign-in and closes for this page view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await releaseDeferredShell(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax:first-run-welcome:v1", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  const signIn = page.getByRole("link", { name: "Sign in to talk to your Pal", exact: true });
  await expect(signIn).toBeVisible({ timeout: 20_000 });
  await expect(signIn).toHaveAttribute("href", "/login?mode=signin&from=%2Fmap");
  await page.screenshot({ path: `${SHOTS}/step9-390-signed-out.png` });
  await page.locator(".palSummonSignIn").getByRole("button", { name: "Close", exact: true }).click();
  await expect(signIn).toBeHidden();
  await page.reload();
  await expectMapLoadingFrameReleased(page);
  await expect(signIn).toBeVisible({ timeout: 20_000 });
  await signIn.click();
  await expect(page).toHaveURL(/\/login\?mode=signin&from=%2Fmap/);
});

test("an under-18 account sees no Pal chip on the map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await releaseDeferredShell(page);
  await preparePalAccount(page, false, undefined, false, true);
  // The map's own eligibility read, after the Pal page's read.
  const ruled = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/pub-pal" && response.request().method() === "GET");
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  await ruled;
  await expect(page.locator(".palSummon")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Talk to Ripley, your Pub Pal", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/step9-390-under18.png` });
});

test("on another city's map the Pal chip says voice talks about London for now", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await releaseDeferredShell(page);
  await preparePalAccount(page);
  await page.goto("/map/manchester");
  await expectMapLoadingFrameReleased(page);
  const chip = page.getByRole("button", { name: "Talk to Ripley, your Pub Pal", exact: true });
  await expect(chip).toContainText("Talks about London for now", { timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/step9-390-outside-london.png` });
});

for (const interruption of ["background", "leave map"] as const) {
  test(`a cold map voice tap cancelled by ${interruption} needs a new tap`, async ({ page }) => {
    await releaseDeferredShell(page);
    const { opened } = await preparePalAccount(page, false, undefined, false, false, true);
    await page.goto("/map");
    await expectMapLoadingFrameReleased(page);
    const chip = page.getByRole("button", { name: "Talk to Ripley, your Pub Pal", exact: true });
    await expect(chip).toBeVisible();
    const held: import("@playwright/test").Route[] = [];
    let block = true;
    let firstScript!: () => void;
    const requested = new Promise<void>((resolve) => { firstScript = resolve; });
    await page.route("**/_next/static/chunks/*.js*", async (route) => {
      if (!block || held.length > 0) return route.continue();
      held.push(route);
      firstScript();
    });
    await test.step("Hold the cold voice script request", async () => {
      await chip.click();
      await requested;
    });
    await page.evaluate((urls) => {
      const surface = window as unknown as { step9ScriptsLoaded: Promise<unknown> };
      surface.step9ScriptsLoaded = Promise.all(urls.map((url) => {
        const script = [...document.scripts].find((entry) => entry.src === url);
        if (!script) throw new Error(`No script element for ${url}`);
        return new Promise((resolve) => script.addEventListener("load", resolve, { once: true }));
      }));
    }, held.map((route) => route.request().url()));
    if (interruption === "background") {
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } else {
      await page.getByRole("link", { name: "You", exact: true }).first().click();
      await expect(page).toHaveURL(/\/u\/karan/);
    }
    block = false;
    await Promise.all(held.map((route) => route.continue()));
    await test.step("Finish the delayed scripts after interruption", async () => {
      await page.evaluate(() => (window as unknown as { step9ScriptsLoaded: Promise<unknown> }).step9ScriptsLoaded);
    });
    if (interruption === "background") {
      await page.evaluate(() => {
        delete (document as unknown as { visibilityState?: string }).visibilityState;
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } else {
      await expect(page).toHaveURL(/\/u\/karan/);
      await page.getByRole("link", { name: "Explore", exact: true }).first().click();
      await expectMapLoadingFrameReleased(page);
    }
    await expect(chip).toBeVisible();
    await expect(page.locator(".palVoiceBar")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/step9-cancel-${interruption.replace(" ", "-")}.png` });
    await test.step("Start voice with a new deliberate tap", async () => {
      await chip.click();
      await opened;
      await expect(page.locator(".palVoiceBar").getByRole("status")).toHaveText(/Ripley is (listening|talking)/);
    });
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(chip).toBeVisible();
  });
}

test("a failed map age check hides a cached Pal chip and requests no microphone", async ({ page }) => {
  await releaseDeferredShell(page);
  await preparePalAccount(page, false, undefined, false, false, true);
  await page.route("**/api/pub-pal", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  let starts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/pub-pal/voice-token" && request.method() === "POST") starts += 1;
  });
  const checked = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/pub-pal" && response.status() === 503);
  await page.goto("/map");
  await checked;
  await expectMapLoadingFrameReleased(page);
  await expect(page.getByRole("button", { name: "Account options for Karan", exact: true })).toBeVisible();
  await expect(page.locator(".palSummon")).toHaveCount(0);
  await expect(page.locator(".palVoiceBar")).toHaveCount(0);
  expect(starts).toBe(0);
  await page.screenshot({ path: `${SHOTS}/step9-age-check-unavailable.png` });
});
