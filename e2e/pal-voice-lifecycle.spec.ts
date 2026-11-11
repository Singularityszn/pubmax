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

// Full Chromium supports the fake microphone on macOS. The headless shell does not.
test.use({ channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } });

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
  let sockets = 0;
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
    sockets++;
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
    speak: () => {
      const audio = Buffer.alloc(16_000);
      for (let i = 0; i < 8_000; i++) audio.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 16_000) * 8_000), i * 2);
      socket.send(JSON.stringify({ type: "audio", audio_event: { audio_base_64: audio.toString("base64"), event_id: 1 } }));
    },
    grants: () => grants, releases: () => releases, closed: () => closed, sockets: () => sockets,
    hold: () => { holdMetadata = true; },
    pending: () => Boolean(pendingMetadata),
    finish: () => { holdMetadata = false; pendingMetadata?.(); },
    save: async (name: string) => writeFile(`${evidence}/${name}.json`, JSON.stringify({ grants, releases, closed, sockets, microphoneCalls: await page.evaluate(() => window.lifecycleProbe.microphoneCalls), lateInputResult: await page.evaluate(() => (window as Window & { lateInputResult?: string }).lateInputResult ?? null), events, visibleButtons: await page.getByRole("button").allTextContents(), transcript: await page.getByRole("log", { name: "Voice chat transcript" }).allTextContents(), visibility: await page.evaluate(() => document.visibilityState), tracks: await page.evaluate(() => window.lifecycleProbe.tracks.map(track => ({ kind: track.kind, state: track.readyState }))) }, null, 2)),
  };
}

async function nativeEvent(page: Page, event: string, data?: unknown) {
  await page.evaluate(({ event, data }) => window.lifecycleProbe.listeners[event]?.forEach(listener => listener(data)), { event, data });
}

async function stopped(page: Page) {
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.tracks.every(track => track.readyState === "ended"))).toBe(true);
}

// The audit requires immediate tap feedback and no second cue at connection.
// Observe the real media element, microphone, mounted panel and installed SDK.
test("the start chime plays during permission wait and never repeats over the greeting", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  await page.setViewportSize({ width: 390, height: 950 });
  await page.addInitScript(() => {
    const events: { kind: string; at: number; gesture: boolean }[] = [];
    Object.assign(window, { chimeEvents: events });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.endsWith("/sounds/pal/voice-start.mp3")) {
        events.push({ kind: "start-play", at: performance.now(), gesture: navigator.userActivation.isActive });
        this.addEventListener("playing", () => events.push({ kind: "start-playing", at: performance.now(), gesture: navigator.userActivation.isActive }), { once: true });
        this.addEventListener("ended", () => events.push({ kind: "start-ended", at: performance.now(), gesture: navigator.userActivation.isActive }), { once: true });
      }
      return play.call(this);
    };
  });
  const app = await setup(page, false, true);
  const cues = () => page.evaluate(() => (window as Window & { chimeEvents: { kind: string; at: number; gesture: boolean }[] }).chimeEvents);
  expect(await cues()).toEqual([]);
  await app.start();
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.microphoneCalls)).toBe(1);
  await expect(page.getByRole("button", { name: "Starting", exact: true })).toBeVisible();
  await expect.poll(async () => (await cues()).map(event => event.kind)).toEqual(["start-play", "start-playing", "start-ended"]);
  expect((await cues())[0]?.gesture).toBe(true);
  expect(app.grants()).toBe(0);
  await page.screenshot({ path: `${evidence}/chime-during-permission.png`, fullPage: true });
  await page.evaluate(() => window.lifecycleProbe.allowMicrophone?.());
  await app.connected();
  app.say("Evening. Where are we drinking?");
  app.speak();
  await expect(page.getByRole("status").filter({ hasText: "Pal is talking" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Voice chat transcript" })).toContainText("Evening. Where are we drinking?");
  expect((await cues()).filter(event => event.kind === "start-play")).toHaveLength(1);
  await page.screenshot({ path: `${evidence}/greeting-without-second-chime.png`, fullPage: true });
  await writeFile(`${evidence}/chime-playback.json`, JSON.stringify({ cues: await cues(), grants: app.grants(), status: await page.getByRole("status").allTextContents() }, null, 2));
  await page.getByRole("button", { name: "End", exact: true }).click();
  await stopped(page);
});

for (const headphones of [true, false]) {
  test(`iOS headphone preference requests ${headphones ? "AirPods" : "the default microphone when no headphones exist"}`, async ({ page, context }) => {
    await context.grantPermissions(["microphone"]);
    await page.addInitScript(({ headphones }) => {
      Object.defineProperty(navigator, "platform", { configurable: true, get: () => "iPhone" });
      const requests: MediaStreamConstraints[] = [];
      Object.assign(window, { microphoneRequests: requests });
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => { requests.push(constraints); return gum(constraints); };
      const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async () => {
        const devices = await enumerate();
        return headphones ? [{ kind: "audioinput", deviceId: "disposable-airpods", groupId: "disposable", label: "AirPods Pro", toJSON: () => ({}) } as MediaDeviceInfo, ...devices] : devices;
      };
    }, { headphones });
    const app = await setup(page);
    await app.start(); await app.connected();
    const requests = await page.evaluate(() => (window as Window & { microphoneRequests: MediaStreamConstraints[] }).microphoneRequests);
    const sdkAudio = requests.map(request => request.audio).filter((audio): audio is MediaTrackConstraints => typeof audio === "object" && audio !== null);
    expect(sdkAudio.length).toBeGreaterThan(0);
    if (headphones) expect(sdkAudio).toContainEqual(expect.objectContaining({ deviceId: { ideal: "disposable-airpods" } }));
    else expect(sdkAudio.every(audio => audio.deviceId === undefined)).toBe(true);
    await writeFile(`${evidence}/ios-headphones-${headphones}.json`, JSON.stringify({ simulatedPlatform: "iPhone", headphones, requests, status: await page.getByRole("status").allTextContents() }, null, 2));
    await page.getByRole("button", { name: "End", exact: true }).click();
    await stopped(page);
  });
}

test("a fast voice connection does not overlap the start chime with greeting audio", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  await page.setViewportSize({ width: 390, height: 950 });
  await page.addInitScript(() => {
    const cues: { kind: string; at: number }[] = [];
    const probe = { cues, audio: null as HTMLMediaElement | null };
    Object.assign(window, { fastChimeProbe: probe });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.endsWith("/sounds/pal/voice-start.mp3")) {
        probe.audio = this;
        for (const event of ["playing", "pause", "ended"]) this.addEventListener(event, () => cues.push({ kind: event, at: performance.now() }), { once: true });
      }
      return play.call(this);
    };
  });
  const app = await setup(page);
  await app.start(); await app.connected();
  app.say("Evening. Where are we drinking?");
  app.speak();
  await expect(page.getByRole("status").filter({ hasText: "Pal is talking" })).toBeVisible();
  const playback = await page.evaluate(() => {
    const probe = (window as Window & { fastChimeProbe: { cues: { kind: string; at: number }[]; audio: HTMLMediaElement | null } }).fastChimeProbe;
    return { cues: probe.cues, greetingAt: performance.now(), chimeRequested: probe.audio !== null, chimeStillPlaying: probe.audio !== null && !probe.audio.paused && !probe.audio.ended, chimeTime: probe.audio?.currentTime, chimeDuration: probe.audio?.duration };
  });
  await page.screenshot({ path: `${evidence}/fast-greeting.png`, fullPage: true });
  const completedCues = await page.evaluate(() => (window as Window & { fastChimeProbe: { cues: { kind: string; at: number }[] } }).fastChimeProbe.cues);
  await writeFile(`${evidence}/fast-greeting-playback.json`, JSON.stringify({ ...playback, completedCues }, null, 2));
  await page.getByRole("button", { name: "End", exact: true }).click();
  await stopped(page);
  expect(playback.chimeRequested).toBe(true);
  expect(playback.chimeStillPlaying).toBe(false);
});

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
  const launcher = await chromium.launchServer({ channel: "chromium", headless: true });
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
    await page.screenshot({ path: `${evidence}/sdk-start-stopped.png`, fullPage: true });
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


// The cancellation decisions are the oracle. Provider timing and browser media
// delivery are controlled here, but all requests use the mounted app and SDK.
test("Cancel stops SDK tracks immediately and a retry waits for the old SDK startup", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page); app.hold();
  await app.start();
  await expect.poll(app.pending).toBe(true);
  await expect.poll(() => page.evaluate(() => window.lifecycleProbe.tracks.some(track => track.readyState === "live"))).toBe(true);
  await page.getByRole("button", { name: "Cancel voice startup" }).click();
  await stopped(page);
  await expect.poll(app.releases).toBe(1);
  await app.start();
  await expect.poll(app.grants).toBe(2);
  expect(app.closed()).toBe(0);
  expect(app.sockets()).toBe(1);
  expect(await page.evaluate(() => window.lifecycleProbe.microphoneCalls)).toBe(3);
  await expect(page.getByRole("button", { name: "Cancel voice startup" })).toBeVisible();
  const refusal = await page.evaluate(async () => {
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); return "opened"; }
    catch (error) { return (error as DOMException).name; }
  });
  expect(refusal).toBe("AbortError");
  await page.screenshot({ path: `${evidence}/retry-waiting.png`, fullPage: true });
  app.finish();
  await app.connected();
  expect(app.sockets()).toBe(2);
  await expect.poll(app.closed).toBe(1);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await stopped(page);
  await expect.poll(app.releases).toBe(2);
  await app.save("cancel-retry");
});

test("a real SDK microphone stream delivered after Cancel is stopped", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page);
  await page.evaluate(() => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    let calls = 0;
    media.getUserMedia = async constraints => {
      const stream = await original(constraints);
      if (++calls === 2) await new Promise<void>(resolve => { window.lifecycleProbe.allowMicrophone = resolve; });
      return stream;
    };
  });
  await app.start();
  await expect.poll(() => page.evaluate(() => Boolean(window.lifecycleProbe.allowMicrophone))).toBe(true);
  await page.getByRole("button", { name: "Cancel voice startup" }).click();
  await page.evaluate(() => window.lifecycleProbe.allowMicrophone?.());
  await stopped(page);
  await expect.poll(app.releases).toBe(1);
  expect(app.grants()).toBe(1);
  expect(app.pending()).toBe(false);
  await page.screenshot({ path: `${evidence}/late-media-cancelled.png`, fullPage: true });
  await app.save("late-media-cancelled");
});

test("cancelling a waiting retry does not block the next voice start", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page); app.hold();
  await app.start();
  await expect.poll(app.pending).toBe(true);
  await page.getByRole("button", { name: "Cancel voice startup" }).click();
  await app.start();
  await expect.poll(app.grants).toBe(2);
  await page.getByRole("button", { name: "Cancel voice startup" }).click();
  await expect.poll(app.releases).toBe(2);
  app.finish();
  await expect.poll(app.closed).toBe(1);
  await app.start();
  await app.connected();
  expect(app.grants()).toBe(3);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await stopped(page);
  await expect.poll(app.releases).toBe(3);
  await app.save("cancel-waiting-retry");
});

test("a late SDK input request stays refused after parallel output setup fails", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page);
  await page.evaluate(() => {
    const state = window as Window & {
      allowInput?: () => void; failOutput?: () => void; lateInputResult?: string;
    };
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function(url, options) {
      if (String(url).includes("raw-audio-processor")) {
        await new Promise<void>(resolve => { state.allowInput = resolve; });
        return addModule.call(this, url, options);
      }
      if (String(url).includes("audio-concat-processor")) {
        await new Promise<void>((_, reject) => { state.failOutput = () => reject(new Error("Disposable output setup failure")); });
      }
      return addModule.call(this, url, options);
    };
  });
  await app.start();
  await expect.poll(() => page.evaluate(() => {
    const state = window as Window & { allowInput?: () => void; failOutput?: () => void };
    return Boolean(state.allowInput && state.failOutput);
  })).toBe(true);
  await page.getByRole("button", { name: "Cancel voice startup" }).click();
  await stopped(page);
  await page.evaluate(() => (window as Window & { failOutput?: () => void }).failOutput?.());
  await expect.poll(app.closed).toBe(1);
  await page.evaluate(() => {
    const state = window as Window & { allowInput?: () => void; lateInputResult?: string };
    const media = navigator.mediaDevices;
    const guarded = media.getUserMedia.bind(media);
    media.getUserMedia = async constraints => {
      try { const stream = await guarded(constraints); state.lateInputResult = "opened"; return stream; }
      catch (error) { state.lateInputResult = (error as DOMException).name; throw error; }
    };
    state.allowInput?.();
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { lateInputResult?: string }).lateInputResult)).toBe("AbortError");
  await stopped(page);
  expect(await page.evaluate(() => window.lifecycleProbe.microphoneCalls)).toBe(2);
  await page.screenshot({ path: `${evidence}/parallel-setup-failure.png`, fullPage: true });
  await app.save("parallel-setup-failure");
});

test("a waiting retry times out without opening a second SDK connection", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const app = await setup(page); app.hold();
  await app.start();
  await expect.poll(app.pending).toBe(true);
  await page.getByRole("button", { name: "Cancel voice startup" }).click();
  await page.clock.install();
  await app.start();
  await expect.poll(app.grants).toBe(2);
  await page.clock.fastForward(20_000);
  await expect(page.getByText("Voice took too long to start. Ask in writing or try again.", { exact: true })).toBeVisible();
  await expect.poll(app.releases).toBe(2);
  expect(app.closed()).toBe(0);
  expect(app.sockets()).toBe(1);
  await stopped(page);
  app.finish();
  await expect.poll(app.closed).toBe(1);
  await page.screenshot({ path: `${evidence}/retry-timeout.png`, fullPage: true });
  await app.save("retry-timeout");
});

test("a real tab hide stops a delayed SDK media response", async () => {
  await inRealTab("delayed", 32170, async (page, context) => {
    const app = await setup(page);
    await page.evaluate(() => {
      const media = navigator.mediaDevices;
      const original = media.getUserMedia.bind(media);
      let calls = 0;
      media.getUserMedia = async constraints => {
        const stream = await original(constraints);
        if (++calls === 2) await new Promise<void>(resolve => { window.lifecycleProbe.allowMicrophone = resolve; });
        return stream;
      };
    });
    await app.start();
    await expect.poll(() => page.evaluate(() => Boolean(window.lifecycleProbe.allowMicrophone))).toBe(true);
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");
    await page.evaluate(() => window.lifecycleProbe.allowMicrophone?.());
    await stopped(page);
    await expect.poll(app.releases).toBe(1);
    await app.save("hidden-delayed-media");
    await other.close();
    await page.bringToFront();
    await page.screenshot({ path: `${evidence}/hidden-delayed-media.png`, fullPage: true });
  });
});
