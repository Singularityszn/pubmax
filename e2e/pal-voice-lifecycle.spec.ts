import { chromium, expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles } from "./helpers/authDoubles";

// D5 and the R1 decision are the oracle: leaving ends the call, permission
// inactivity does not, and returning requires an explicit Carry on tap.
// Only the provider and native bridge are disposable boundary doubles. The
// mounted product, ElevenLabs SDK, browser microphone and worklets are real.
const evidence = process.env.PUBMAX_LIFECYCLE_EVIDENCE_DIR ?? "artifacts/pal-voice-lifecycle";
test.beforeAll(async () => { await mkdir(evidence, { recursive: true }); });

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream"] } });

type Probe = {
  microphoneCalls: number;
  tracks: MediaStreamTrack[];
  listeners: Record<string, ((data?: unknown) => void)[]>;
  allowMicrophone?: () => void;
};

declare global { interface Window { lifecycleProbe: Probe } }

async function setup(page: Page, native = false, deferMicrophone = false) {
  await page.addInitScript(({ native, deferMicrophone }) => {
    const probe: Probe = window.lifecycleProbe = { microphoneCalls: 0, tracks: [], listeners: {} };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      probe.microphoneCalls++;
      if (deferMicrophone && probe.microphoneCalls === 1) await new Promise<void>(resolve => { probe.allowMicrophone = resolve; });
      const stream = await gum(constraints);
      probe.tracks.push(...stream.getTracks());
      return stream;
    };
    if (native) {
      Object.assign(window, {
        CapacitorCustomPlatform: { name: "ios" },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
          PluginHeaders: [{ name: "App", methods: [{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] }],
          nativeCallback: (_plugin: string, method: string, options: { eventName: string }, callback: (data?: unknown) => void) => {
            if (method === "addListener") (probe.listeners[options.eventName] ??= []).push(callback);
            return String(probe.listeners[options.eventName]?.length ?? 0);
          },
          nativePromise: async () => undefined,
        },
      });
    }
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax:first-run-welcome:v1", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({ version: 1, activatedAt: new Date().toISOString() }));
  }, { native, deferMicrophone });
  const auth = await installAuthDoubles(page);
  await page.goto(new URL("/today", String(test.info().project.use.baseURL)).href);
  await auth.signedInAs("A");
  const stamp = "2026-11-09T12:00:00.000Z";
  const pal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id, name: "Ripley",
    adultAttestedAt: stamp, appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
    muted: false, hidden: false, masteryPoints: 0, createdAt: stamp, updatedAt: stamp,
  };
  await page.route("**/api/pub-pal", route => route.fulfill({ json: { pal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", route => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/tool-turn", route => route.fulfill({ status: 204 }));
  const events: unknown[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/pub-pal" || url.pathname.startsWith("/auth/v1")) events.push({ network: url.pathname, method: request.method(), at: Date.now() });
  });
  let grants = 0;
  let releases = 0;
  let closed = 0;
  let holdMetadata = false;
  let pendingMetadata: (() => void) | undefined;
  await page.route("**/api/pub-pal/voice-token", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true, retention: "provider_default" } });
    const body = route.request().postDataJSON();
    events.push({ request: body, at: Date.now() });
    if (body?.action === "release") { releases++; return route.fulfill({ status: 204 }); }
    grants++;
    return route.fulfill({ json: { signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=disposable", conversationId: `conv_lifecycle_${grants}`, maxSessionSeconds: 180 } });
  });
  let socket: WebSocketRoute;
  await page.routeWebSocket(/api\.elevenlabs\.io/, ws => {
    socket = ws;
    ws.onClose(() => { closed++; events.push({ socketClosed: closed, at: Date.now() }); });
    ws.onMessage(message => {
      const event = JSON.parse(String(message));
      if (event.type !== "conversation_initiation_client_data") return;
      const complete = () => ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: {
        conversation_id: `conv_lifecycle_${grants}`, agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000",
      } }));
      if (holdMetadata) pendingMetadata = complete;
      else complete();
    });
  });
  await page.goto(new URL("/pal", String(test.info().project.use.baseURL)).href);
  await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toBeVisible();
  return {
    start: async () => { await page.getByRole("button", { name: "Start voice chat", exact: true }).click(); },
    connected: async () => { await expect(page.getByRole("status").filter({ hasText: /Pal is (listening|talking)/ })).toBeVisible(); },
    say: (text: string) => socket.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: text, event_id: 1 } })),
    grants: () => grants, releases: () => releases, closed: () => closed,
    hold: () => { holdMetadata = true; },
    pending: () => Boolean(pendingMetadata),
    finish: () => pendingMetadata?.(),
    save: async (name: string) => writeFile(`${evidence}/${name}.json`, JSON.stringify({ grants, releases, closed, events, visibleButtons: await page.getByRole("button").allTextContents(), transcript: await page.getByRole("log", { name: "Voice chat transcript" }).allTextContents(), visibility: await page.evaluate(() => document.visibilityState), tracks: await page.evaluate(() => window.lifecycleProbe.tracks.map(track => ({ kind: track.kind, state: track.readyState }))) }, null, 2)),
  };
}

async function nativeEvent(page: Page, event: string, data?: unknown) {
  await page.evaluate(({ event, data }) => window.lifecycleProbe.listeners[event]?.forEach(listener => listener(data)), { event, data });
}

async function stopped(page: Page) {
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.tracks.every(track => track.readyState === "ended"))).toBe(true);
}

for (const width of [390, 768, 1440]) {
  test(`${width}px: background ends a connected call, preserves transcript and Carry on starts a fresh call`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 950 });
    await context.grantPermissions(["microphone"]);
    const app = await setup(page, true);
    await expect.poll(() => page.evaluate(() => window.lifecycleProbe.listeners.pause?.length ?? 0)).toBeGreaterThan(0);
    await app.start(); await app.connected();
    app.say("Evening. Where are we drinking?");
    await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Evening. Where are we drinking?");
    await page.screenshot({ path: `${evidence}/connected-${width}.png`, fullPage: true });
    await nativeEvent(page, "pause");
    await nativeEvent(page, "pause");
    await expect(page.getByRole("button", { name: "Carry on", exact: true })).toBeVisible();
    await stopped(page);
    await expect.poll(app.releases).toBe(1);
    await expect.poll(app.closed).toBe(1);
    await nativeEvent(page, "resume");
    expect(app.grants()).toBe(1);
    await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Evening. Where are we drinking?");
    await page.screenshot({ path: `${evidence}/carry-on-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Carry on", exact: true }).click();
    await app.connected();
    expect(app.grants()).toBe(2);
    await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Evening. Where are we drinking?");
    await page.getByRole("button", { name: "End", exact: true }).click();
    await stopped(page);
    await expect.poll(app.releases).toBe(2);
    await app.save(`background-${width}`);
  });
}

test("a deferred first microphone request keeps starting through foreground inactive", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page, true, true);
  await app.start();
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.microphoneCalls)).toBe(1);
  await expect(page.getByRole("button", { name: "Starting", exact: true })).toBeVisible();
  await nativeEvent(page, "appStateChange", { isActive: false });
  await expect(page.getByRole("button", { name: "Starting", exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/permission-pending.png`, fullPage: true });
  await nativeEvent(page, "appStateChange", { isActive: true });
  await page.evaluate(() => window.lifecycleProbe.allowMicrophone?.());
  await app.connected();
  expect(app.grants()).toBe(1);
  expect(app.releases()).toBe(0);
  await page.screenshot({ path: `${evidence}/permission-connected.png`, fullPage: true });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await stopped(page); await app.save("permission");
});

test("background while the first microphone request is pending cancels without a provider grant", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page, true, true);
  await app.start();
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.microphoneCalls)).toBe(1);
  await nativeEvent(page, "pause");
  await page.evaluate(() => window.lifecycleProbe.allowMicrophone?.());
  await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.tracks.length)).toBe(1);
  await stopped(page);
  expect(app.grants()).toBe(0);
  await app.save("pending-permission-background");
});

// Playwright forces focus and visibility on its managed pages. A disposable
// Chrome process with noDefaults keeps the browser's real tab visibility.
async function inRealTab(name: string, port: number, run: (page: Page, context: BrowserContext) => Promise<void>) {
  const launcher = await chromium.launchServer({ channel: test.info().project.use.channel, headless: true });
  const executable = launcher.process().spawnfile;
  await launcher.close();
  const profile = `${process.cwd()}/artifacts/pal-lifecycle-chrome-profile-${name}`;
  const child = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--use-fake-device-for-media-stream", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      child.stderr.on("data", data => { if (String(data).includes("DevTools listening on")) resolve(); });
      child.on("error", reject);
      child.on("exit", code => reject(new Error(`Disposable Chrome exited ${code}`)));
    });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await page.setViewportSize({ width: 390, height: 950 });
    await context.grantPermissions(["microphone"], { origin: String(test.info().project.use.baseURL) });
    await run(page, context);
  } finally {
    await browser?.close();
    const exited = new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
    child.kill("SIGTERM");
    await exited;
    await rm(profile, { recursive: true, force: true });
  }
}

test("390px: a page frozen during SDK startup stops the microphone before the socket finishes", async () => {
  await inRealTab("frozen", 32169, async (page, context) => {
    const app = await setup(page); app.hold();
    await app.start();
    await expect.poll(app.pending).toBe(true);
    const microphoneCalls = await page.evaluate(() => window.lifecycleProbe.microphoneCalls);
    await expect.poll(() => page.evaluate(() => window.lifecycleProbe.tracks.some(track => track.readyState === "live"))).toBe(true);
    await page.screenshot({ path: `${evidence}/sdk-start-connecting.png`, fullPage: true });
    const session = await context.newCDPSession(page);
    await session.send("Page.setWebLifecycleState", { state: "frozen" });
    await session.send("Page.setWebLifecycleState", { state: "active" });
    await stopped(page);
    expect(app.pending()).toBe(true);
    expect(app.closed()).toBe(0);
    await app.save("sdk-start-frozen");
    app.finish();
    await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toBeEnabled();
    await expect.poll(app.closed).toBe(1);
    await expect.poll(app.releases).toBe(1);
    await stopped(page);
    expect(await page.evaluate(() => window.lifecycleProbe.microphoneCalls)).toBe(microphoneCalls);
    await app.save("sdk-start-finished");
  });
});

test("a real browser tab hide ends the call and returning offers Carry on without restarting", async () => {
  await inRealTab("tab", 32168, async (page, context) => {
    const app = await setup(page);
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
    await app.start(); await app.connected();
    app.say("Your conversation stays here when you return.");
    await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Your conversation stays here when you return.");
    await page.screenshot({ path: `${evidence}/real-tab-connected.png`, fullPage: true });
    const session = await context.newCDPSession(page);
    const { targetInfo } = await session.send("Target.getTargetInfo");
    const { targetId } = await session.send("Target.createTarget", { url: "about:blank", browserContextId: targetInfo.browserContextId, newWindow: false, background: false });
    await session.send("Target.activateTarget", { targetId });
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");
    await expect.poll(app.releases).toBe(1);
    await expect.poll(app.closed).toBe(1);
    await stopped(page);
    await session.send("Target.closeTarget", { targetId });
    await session.send("Target.activateTarget", { targetId: targetInfo.targetId });
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
    await page.screenshot({ path: `${evidence}/real-tab-returned.png`, fullPage: true });
    await app.save("real-tab-returned");
    await expect(page.getByRole("button", { name: "Carry on", exact: true })).toBeVisible();
    expect(app.grants()).toBe(1);
    await page.getByRole("button", { name: "Carry on", exact: true }).click();
    await app.connected();
    expect(app.grants()).toBe(2);
    await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Your conversation stays here when you return.");
    await page.getByRole("button", { name: "End", exact: true }).click();
    await stopped(page);
    await expect.poll(app.releases).toBe(2);
    await app.save("real-tab-background");
  });
});
