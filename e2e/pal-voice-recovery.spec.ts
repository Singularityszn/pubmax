import { expect, test, type WebSocketRoute } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

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
  await page.routeWebSocket(/api\.elevenlabs\.io/, (socket) => {
    sockets.push(socket);
    socket.onMessage((message) => {
      const event = JSON.parse(String(message)) as { type?: string };
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
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1, activatedAt: new Date().toISOString(),
    }));
  });
  await page.goto("/pal");
  const start = page.getByRole("button", { name: "Start voice chat", exact: true });
  const end = page.getByRole("button", { name: "End", exact: true });
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
  await expect.poll(() => released).toEqual(["conv_recovery1", "conv_recovery2"]);
  await page.screenshot({ path: test.info().outputPath("transport-loss-recovered.png") });

  await begin();
  sockets[2]!.send(JSON.stringify({
    type: "agent_response",
    agent_response_event: { agent_response: "We are connected again.", event_id: 2 },
  }));
  await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("We are connected again.");
  expect(sessions).toBe(3);
  await end.click();
  await expect.poll(() => released).toEqual(["conv_recovery1", "conv_recovery2", "conv_recovery3"]);
});
