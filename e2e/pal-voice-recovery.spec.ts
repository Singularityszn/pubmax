import { expect, test, type WebSocketRoute } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, AUTH_STORAGE_KEY, accessJwt, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased, mobileMapShellControl } from "./helpers/mobileMapShell";

// The real voice panel and SDK use a disposable provider socket. This proves
// browser recovery and session release, without a provider account or key.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
});

test("a voice session can end, restart, recover from transport loss, and start again", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthDoubles(page);
  await installDeterministicMapBasemap(page);
  await seedSignedIn(page, "A");
  const stamp = "2026-10-20T00:00:00Z";
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: {
    pal: {
      ...DEFAULT_PAL_DRAFT,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerId: ACCOUNTS.A.id,
      name: "Recovery Pal",
      adultAttestedAt: stamp,
      muted: false,
      hidden: false,
      proposalPreferences: { memories: true, routes: true },
      masteryPoints: 0,
      createdAt: stamp,
      updatedAt: stamp,
    },
    adultOnFile: true,
  } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/tool-turn", (route) => route.fulfill({ status: 204 }));

  let sessions = 0;
  const released: string[] = [];
  await page.route("**/api/pub-pal/voice-token", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { available: true, retention: "provider_default" } });
    }
    const body = route.request().postDataJSON() as { action?: string; conversationId?: string } | null;
    if (body?.action === "release") {
      released.push(body.conversationId ?? "");
      return route.fulfill({ status: 204 });
    }
    sessions += 1;
    return route.fulfill({ json: {
      signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_e2e",
      conversationId: `conv_recovery${sessions}`,
      maxSessionSeconds: 180,
    } });
  });

  const sockets: WebSocketRoute[] = [];
  const clientEvents: Array<{ type?: string; tool_call_id?: string; result?: string; text?: string }> = [];
  await page.routeWebSocket(/api\.elevenlabs\.io/, (socket) => {
    sockets.push(socket);
    socket.onMessage((message) => {
      const event = JSON.parse(String(message)) as typeof clientEvents[number];
      if (event.type !== "user_audio_chunk") clientEvents.push(event);
      if (event.type !== "conversation_initiation_client_data") return;
      socket.send(JSON.stringify({
        type: "conversation_initiation_metadata",
        conversation_initiation_metadata_event: {
          conversation_id: `conv_recovery${sessions}`,
          agent_output_audio_format: "pcm_16000",
          user_input_audio_format: "pcm_16000",
        },
      }));
    });
  });
  await page.addInitScript(({ account, authKey, token }) => {
    const session = JSON.parse(localStorage.getItem(authKey) ?? "null");
    if (session) localStorage.setItem(authKey, JSON.stringify({ ...session, access_token: token }));
    localStorage.setItem("pubmax_account_owner", account.id);
    localStorage.setItem("pubmax_handle", account.handle);
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1, activatedAt: new Date().toISOString(),
    }));
  }, { account: ACCOUNTS.A, authKey: AUTH_STORAGE_KEY, token: accessJwt(ACCOUNTS.A) });
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Account options for Karan" })).toBeVisible();
  await page.getByRole("link", { name: "Pub Pal", exact: true }).click();
  const start = page.getByRole("button", { name: "Start voice chat", exact: true });
  const end = page.getByRole("button", { name: "End", exact: true });
  await expect(start).toBeVisible();
  const begin = async () => {
    await start.click();
    await expect(end).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Pal is listening" })).toBeVisible();
  };

  await begin();
  sockets[0]!.send(JSON.stringify({
    type: "agent_response",
    agent_response_event: { agent_response: "We can stop whenever you want.", event_id: 1 },
  }));
  await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("We can stop whenever you want.");
  await end.click();
  await expect(start).toBeEnabled();
  await expect.poll(() => released).toEqual(["conv_recovery1"]);

  await begin();
  sockets[1]!.close({ code: 1011, reason: "Disposable transport interruption" });
  await expect(start).toBeEnabled();
  await expect(end).toHaveCount(0);
  await expect(page.locator(".palVoiceError")).toContainText("The voice line dropped");
  await expect.poll(() => released).toEqual(["conv_recovery1", "conv_recovery2"]);
  await page.screenshot({ path: test.info().outputPath("transport-loss-recovered.png") });

  await begin();
  sockets[2]!.send(JSON.stringify({
    type: "agent_response",
    agent_response_event: { agent_response: "We are connected again.", event_id: 2 },
  }));
  await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("We are connected again.");
  expect(sessions).toBe(3);

  // A missing pick must return the refusal through the SDK tool result once.
  const beforeRefusal = clientEvents.length;
  sockets[2]!.send(JSON.stringify({
    type: "client_tool_call",
    client_tool_call: { tool_name: "map_focus_pick", tool_call_id: "missing_pick", parameters: { number: 9 } },
  }));
  await expect.poll(() => clientEvents.find(event => event.tool_call_id === "missing_pick")).toMatchObject({
    type: "client_tool_result",
    result: "The map could not show that pick. No picks are on the map yet.",
  });
  expect(clientEvents.slice(beforeRefusal).filter(event => event.type === "contextual_update")).toEqual([]);

  await end.click();
  await expect.poll(() => released).toEqual(["conv_recovery1", "conv_recovery2", "conv_recovery3"]);

  // end_call and silence use the same normal provider close. Both retain a
  // friendly status and require an explicit Carry on tap for the next call.
  for (const [index, reason] of ["end_call", "silence"].entries()) {
    if (index === 0) await begin();
    const number = 4 + index;
    sockets[number - 1]!.send(JSON.stringify({
      type: "agent_response",
      agent_response_event: { agent_response: "Tap me when you want another pub.", event_id: number },
    }));
    await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Tap me when you want another pub.");
    sockets[number - 1]!.close({ code: 1000, reason });
    await expect(page.getByRole("status").filter({ hasText: "Recovery Pal ended the call" })).toBeVisible();
    await expect(page.locator(".palVoiceError")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Carry on", exact: true })).toBeEnabled();
    await expect.poll(() => released.length).toBe(number);
    await page.screenshot({ path: test.info().outputPath(`friendly-${reason}.png`) });
    expect(sessions).toBe(number);
    if (index === 0) {
      await page.getByRole("button", { name: "Carry on", exact: true }).click();
      await expect(end).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Pal is listening" })).toBeVisible();
    }
  }

  await page.getByRole("button", { name: "Carry on", exact: true }).click();
  await expect(end).toBeVisible();
  sockets[5]!.send(JSON.stringify({
    type: "client_tool_call",
    client_tool_call: { tool_name: "map_open", tool_call_id: "open_map", parameters: {} },
  }));
  await expect(page).toHaveURL(/\/map/);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const bar = page.getByRole("region", { name: "Voice chat with Recovery Pal" });
  await expect(bar.getByRole("button", { name: "End", exact: true })).toBeVisible();
  sockets[5]!.send(JSON.stringify({
    type: "agent_response",
    agent_response_event: { agent_response: "The map is open.", event_id: 6 },
  }));
  await expect(bar).toContainText("The map is open.");
  await page.screenshot({ path: test.info().outputPath("map-before-friendly-close.png") });
  sockets[5]!.close({ code: 1000, reason: "end_call" });
  await expect(bar.getByRole("status")).toHaveText("Recovery Pal ended the call");
  await expect(bar.getByRole("button", { name: "Carry on", exact: true })).toBeEnabled();
  await expect.poll(() => released.length).toBe(6);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await expectMapLoadingFrameReleased(page);
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        const toggle = page.getByRole("button", { name: `Switch to ${theme} theme`, exact: true });
        const inSheet = width === 390;
        if (inSheet) {
          await (await mobileMapShellControl(page, "more")).click();
          await page.getByRole("tab", { name: "Layers", exact: true }).click();
        }
        await toggle.click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (inSheet) await page.keyboard.press("Escape");
      }
      await expect.poll(() => page.evaluate(() => (window as Window & {
        __pubmaxPaintedMapTapPoints?: () => unknown[];
      }).__pubmaxPaintedMapTapPoints?.().length ?? 0)).toBeGreaterThan(0);
      await expect(bar.getByRole("status")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`friendly-map-${width}-${theme}.png`) });
    }
  }
  await bar.getByRole("button", { name: "Close voice chat", exact: true }).click();
  await expect(bar).toHaveCount(0);
});
