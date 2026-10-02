import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  expect,
  test,
  type ConsoleMessage,
  type Page,
  type Request,
  type Route,
  type TestInfo,
  type WebSocket as PlaywrightWebSocket,
} from "@playwright/test";
import {
  ELEVENLABS_LIBSAMPLERATE_PATH,
  ELEVENLABS_WORKLET_PATHS,
} from "../lib/elevenlabsWorkletAssets";

const ASSETS = [
  {
    path: ELEVENLABS_WORKLET_PATHS.rawAudioProcessor,
    source: "@elevenlabs/client/worklets/rawAudioProcessor.js",
  },
  {
    path: ELEVENLABS_WORKLET_PATHS.audioConcatProcessor,
    source: "@elevenlabs/client/worklets/audioConcatProcessor.js",
  },
  {
    path: ELEVENLABS_LIBSAMPLERATE_PATH,
    source: "@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js",
  },
] as const;

// The runner's existing expectation ceiling, not a processing retry or sleep.
const PORT_EVENT_DEADLINE_MS = 10_000;
const FAKE_SUPABASE_SETTINGS = "https://pubmaxx-e2e.supabase.co/auth/v1/settings";

type ProcessingEvidence = {
  secureContext: boolean;
  contextState: OfflineAudioContext["state"];
  firstPcm: {
    length: number;
    minimum: number;
    maximum: number;
    nonzero: number;
    rms: number;
  } | null;
  concatIdleObserved: boolean;
  concatStarted: boolean;
  concatFinished: boolean;
  deadlineExpired: boolean;
  rendered: {
    frames: number;
    sampleRate: number;
    earlyMaxError: number;
    lateMaxError: number;
    tailMaxAbs: number;
    firstNonzeroFrame: number;
    lastNonzeroFrame: number;
    nonfiniteSamples: number;
    ranges: { start: number; end: number; minimum: number; maximum: number; rms: number }[];
  } | null;
  processorErrors: string[];
  operationErrors: string[];
  cleanupErrors: string[];
  policyViolations: { directive: string; disposition: string; blockedSource: string }[];
};

async function exerciseWorklets(
  page: Page,
  testInfo: TestInfo,
  sessionSampleRate: 16_000 | 48_000,
) {
  const failedAssets: { path: string; failure: string | null }[] = [];
  const pageErrors: string[] = [];
  let consoleErrorCount = 0;
  const consoleErrors: { message: string; source: string; line: number }[] = [];
  let voiceGrantPostCount = 0;
  let providerSocketCount = 0;
  const assetPaths = new Set<string>(ASSETS.map((asset) => asset.path));
  const diagnosticSource = (value: string) => {
    try {
      const url = new URL(value);
      return url.origin + (url.origin === new URL(page.url()).origin ? url.pathname : "");
    } catch {
      return "unknown";
    }
  };
  const onRequestFailed = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (assetPaths.has(path)) {
      failedAssets.push({ path, failure: request.failure()?.errorText ?? null });
    }
  };
  const onRequest = (request: Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/pub-pal/voice-token"
    ) voiceGrantPostCount += 1;
  };
  const onPageError = (error: Error) => { pageErrors.push(error.name); };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    consoleErrorCount += 1;
    if (consoleErrors.length < 4) {
      const location = message.location();
      consoleErrors.push({
        message: message.text()
          .replace(/https?:\/\/[^\s)]+/g, diagnosticSource)
          .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
          .replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, "[redacted]")
          .slice(0, 240),
        source: diagnosticSource(location.url),
        line: location.lineNumber,
      });
    }
  };
  const onWebSocket = (socket: PlaywrightWebSocket) => {
    if (/elevenlabs/i.test(new URL(socket.url()).hostname)) providerSocketCount += 1;
  };
  page.on("requestfailed", onRequestFailed);
  page.on("request", onRequest);
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("websocket", onWebSocket);
  // Only the runner's non-resolving public settings host is doubled. No session,
  // app API, worklet asset, or provider credential is supplied by this fixture.
  const onFakeSupabaseSettings = async (route: Route) => {
    const method = route.request().method();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "apikey",
    };
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
    } else if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify({ external: { google: false, apple: false, azure: false } }),
      });
    } else {
      await route.continue();
    }
  };
  try {
    await page.route(FAKE_SUPABASE_SETTINGS, onFakeSupabaseSettings);
    const documentResponse = await page.goto("/pal");
    expect(documentResponse).not.toBeNull();
    expect(documentResponse!.status()).toBe(200);
    expect(documentResponse!.headers()["content-type"]).toMatch(/^text\/html(?:;|$)/i);
    expect(new URL(page.url()).pathname).toBe("/pal");
    await expect(page.getByRole("main")).toBeVisible();

    const csp = documentResponse!.headers()["content-security-policy"];
    expect(csp, "The real /pal response must enforce CSP").toBeTruthy();
    const scriptSource = csp.split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .find(([name]) => name === "script-src");
    expect(scriptSource).toBeDefined();
    expect(scriptSource).toContain("'self'");
    expect(scriptSource!.some((token) => /^'nonce-[^']+'$/.test(token))).toBe(true);
    for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "blob:", "data:"]) {
      expect(scriptSource).not.toContain(forbidden);
    }
    expect(scriptSource!.some((token) => /(?:^|\/)cdn\.jsdelivr\.net(?:\/|$)/i.test(token))).toBe(false);

    const processing = await page.evaluate(async ({ paths, negotiatedRate, deadlineMs }): Promise<ProcessingEvidence> => {
      const context = new OfflineAudioContext(1, 8_192, 48_000);
      const processorErrors: string[] = [];
      const operationErrors: string[] = [];
      const cleanupErrors: string[] = [];
      const policyViolations: {
        directive: string;
        disposition: string;
        blockedSource: string;
      }[] = [];
      const onPolicyViolation = (event: SecurityPolicyViolationEvent) => {
        let blockedSource = event.blockedURI;
        if (/^(?:data|blob):/.test(blockedSource)) {
          blockedSource = blockedSource.slice(0, blockedSource.indexOf(":") + 1);
        } else if (/^(?:https?|wss?):/.test(blockedSource)) {
          const blocked = new URL(blockedSource);
          blockedSource = blocked.origin + (
            Object.values(paths).includes(blocked.pathname) ? blocked.pathname : ""
          );
        }
        policyViolations.push({
          directive: event.effectiveDirective,
          disposition: event.disposition,
          blockedSource,
        });
      };
      document.addEventListener("securitypolicyviolation", onPolicyViolation);
      let raw: AudioWorkletNode | undefined;
      let concat: AudioWorkletNode | undefined;
      let source: AudioBufferSourceNode | undefined;
      let rendering: Promise<AudioBuffer> | undefined;
      let deadline: number | undefined;
      let firstPcm: ProcessingEvidence["firstPcm"] = null;
      let concatIdleObserved = false;
      let concatStarted = false;
      let concatFinished = false;
      let pcmQueued = false;
      let deadlineExpired = false;
      let rendered: ProcessingEvidence["rendered"] = null;

      try {
        if (negotiatedRate !== context.sampleRate) {
          await context.audioWorklet.addModule(paths.resampler);
        }
        await context.audioWorklet.addModule(paths.raw);
        await context.audioWorklet.addModule(paths.concat);
        raw = new AudioWorkletNode(context, "rawAudioProcessor", { outputChannelCount: [1] });
        concat = new AudioWorkletNode(context, "audioConcatProcessor", {
          numberOfInputs: 0,
          outputChannelCount: [1],
        });
        let finishEvents!: () => void;
        const events = new Promise<void>((resolveEvents) => { finishEvents = resolveEvents; });
        let finishIdle!: () => void;
        const idle = new Promise<void>((resolveIdle) => { finishIdle = resolveIdle; });
        const checkEvents = () => {
          if (processorErrors.length > 0) { finishIdle(); finishEvents(); }
          else if (firstPcm !== null && concatFinished) finishEvents();
        };
        raw.onprocessorerror = () => { processorErrors.push("rawAudioProcessor"); checkEvents(); };
        concat.onprocessorerror = () => { processorErrors.push("audioConcatProcessor"); checkEvents(); };
        raw.port.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (firstPcm !== null) return;
          if (!Array.isArray(data) || !(data[0] instanceof Int16Array) || typeof data[1] !== "number") {
            processorErrors.push("Invalid raw PCM message");
          } else {
            const pcm = data[0];
            firstPcm = {
              length: pcm.length,
              minimum: pcm.reduce((minimum, sample) => Math.min(minimum, sample), Infinity),
              maximum: pcm.reduce((maximum, sample) => Math.max(maximum, sample), -Infinity),
              nonzero: pcm.reduce((count, sample) => count + Number(sample !== 0), 0),
              rms: data[1],
            };
          }
          checkEvents();
        };
        concat.port.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (
            typeof data === "object" && data !== null &&
            "type" in data && data.type === "process" &&
            "finished" in data && typeof data.finished === "boolean"
          ) {
            if (!pcmQueued && data.finished) {
              concatIdleObserved = true;
              finishIdle();
            } else if (pcmQueued && !data.finished) concatStarted = true;
            else if (pcmQueued && concatStarted && data.finished) concatFinished = true;
          }
          checkEvents();
        };
        raw.port.onmessageerror = () => { processorErrors.push("Raw port message error"); checkEvents(); };
        concat.port.onmessageerror = () => { processorErrors.push("Concat port message error"); checkEvents(); };
        deadline = window.setTimeout(() => {
          deadlineExpired = true;
          finishIdle();
          finishEvents();
        }, deadlineMs);

        // The idle process event proves the real node has run, not that its
        // asynchronous resampler is ready. Output still owes the numeric checks.
        raw.port.postMessage({ type: "setFormat", format: "pcm", sampleRate: negotiatedRate });
        concat.port.postMessage({ type: "setFormat", format: "pcm", sampleRate: negotiatedRate });
        const pcmInput = context.createBuffer(1, 8_192, context.sampleRate);
        pcmInput.getChannelData(0).fill(0.25);
        source = context.createBufferSource();
        source.buffer = pcmInput;
        source.connect(raw);
        raw.connect(context.destination);
        concat.connect(context.destination);
        const suspension = context.suspend(128 / context.sampleRate);
        source.start();
        rendering = context.startRendering();
        await Promise.all([suspension, idle]);
        if (deadlineExpired || processorErrors.length > 0 || !concatIdleObserved) {
          throw new Error("Concat's real idle process event was not observed.");
        }
        const pcmOutput = new Int16Array(1_600).fill(16_384);
        pcmQueued = true;
        concat.port.postMessage({ type: "buffer", buffer: pcmOutput.buffer });
        await context.resume();
        const [audio] = await Promise.all([rendering, events]);
        const channel = audio.getChannelData(0);
        const maxError = (start: number, end: number, expected: number) => {
          let maximum = 0;
          for (let frame = start; frame < end; frame += 1) {
            maximum = Math.max(maximum, Math.abs(channel[frame] - expected));
          }
          return maximum;
        };
        let firstNonzeroFrame = -1;
        let lastNonzeroFrame = -1;
        let nonfiniteSamples = 0;
        for (let frame = 0; frame < channel.length; frame += 1) {
          if (!Number.isFinite(channel[frame])) nonfiniteSamples += 1;
          else if (channel[frame] !== 0) {
            if (firstNonzeroFrame === -1) firstNonzeroFrame = frame;
            lastNonzeroFrame = frame;
          }
        }
        const rangeEvidence = (start: number, end: number) => {
          let minimum = Infinity;
          let maximum = -Infinity;
          let sumSquares = 0;
          for (let frame = start; frame < end; frame += 1) {
            minimum = Math.min(minimum, channel[frame]);
            maximum = Math.max(maximum, channel[frame]);
            sumSquares += channel[frame] * channel[frame];
          }
          return { start, end, minimum, maximum, rms: Math.sqrt(sumSquares / (end - start)) };
        };
        rendered = {
          frames: audio.length,
          sampleRate: audio.sampleRate,
          earlyMaxError: maxError(800, 1_201, 0.5),
          lateMaxError: maxError(3_200, 3_601, negotiatedRate === 48_000 ? 0 : 0.5),
          tailMaxAbs: maxError(6_000, 8_192, 0),
          firstNonzeroFrame,
          lastNonzeroFrame,
          nonfiniteSamples,
          ranges: [rangeEvidence(0, 128), rangeEvidence(800, 1_201), rangeEvidence(3_200, 3_601)],
        };
      } catch (error) {
        operationErrors.push(error instanceof Error ? error.name : "Unknown audio error");
      } finally {
        if (deadline !== undefined) window.clearTimeout(deadline);
        source?.disconnect();
        raw?.disconnect();
        concat?.disconnect();
        // Offline contexts have no close(). Finish even a module-failure context.
        try {
          if (rendering && context.state === "suspended") await context.resume();
          rendering ??= context.startRendering();
          await rendering;
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error.name : "Unknown cleanup error");
        }
        for (const node of [raw, concat]) {
          if (!node) continue;
          node.onprocessorerror = null;
          node.port.onmessage = null;
          node.port.onmessageerror = null;
          node.port.close();
        }
        document.removeEventListener("securitypolicyviolation", onPolicyViolation);
      }
      return {
        secureContext: isSecureContext,
        contextState: context.state,
        firstPcm,
        concatIdleObserved,
        concatStarted,
        concatFinished,
        deadlineExpired,
        rendered,
        processorErrors,
        operationErrors,
        cleanupErrors,
        policyViolations,
      };
    }, {
      paths: {
        raw: ELEVENLABS_WORKLET_PATHS.rawAudioProcessor,
        concat: ELEVENLABS_WORKLET_PATHS.audioConcatProcessor,
        resampler: ELEVENLABS_LIBSAMPLERATE_PATH,
      },
      negotiatedRate: sessionSampleRate,
      deadlineMs: PORT_EVENT_DEADLINE_MS,
    });

    // Keep failure samples even when CSP or a missing asset prevents loading.
    await testInfo.attach("pubpal-worklet-processing", {
      body: JSON.stringify({ sessionSampleRate, processing, failedAssets, pageErrors,
        consoleErrorCount, consoleErrors, voiceGrantPostCount, providerSocketCount }, null, 2),
      contentType: "application/json",
    });
    const loadedAssets = sessionSampleRate === 16_000 ? ASSETS : ASSETS.slice(0, 2);
    const assetEvidence = [];
    // Separate HTTP provenance. These are not the unobservable addModule
    // response bodies; actual CSP/module execution is proved by processing.
    for (const asset of loadedAssets) {
      const url = new URL(asset.path, page.url());
      expect(url.origin).toBe(new URL(page.url()).origin);
      expect(url.search).toBe("");
      const response = await page.request.get(url.href, { maxRedirects: 0 });
      try {
        expect(response.url()).toBe(url.href);
        expect(response.status()).toBe(200);
        const mime = (response.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        expect(mime).toMatch(/^(?:application|text)\/(?:javascript|ecmascript)$/);
        const served = await response.body();
        const installed = await readFile(resolve(process.cwd(), "node_modules", asset.source));
        const servedSha256 = createHash("sha256").update(served).digest("hex");
        const installedSha256 = createHash("sha256").update(installed).digest("hex");
        expect(servedSha256, `${asset.path} HTTP bytes must match the copied package`).toBe(installedSha256);
        assetEvidence.push({
          path: asset.path, status: response.status(), mime, bytes: served.length,
          sha256: servedSha256, evidence: "separate HTTP response, not captured addModule bytes",
        });
      } finally {
        await response.dispose();
      }
    }
    await testInfo.attach("pubpal-worklet-assets", {
      body: JSON.stringify({ sessionSampleRate, assets: assetEvidence }, null, 2),
      contentType: "application/json",
    });
    expect(processing.secureContext).toBe(true);
    expect(processing.contextState).toBe("closed");
    expect(processing.operationErrors).toEqual([]);
    expect(processing.cleanupErrors).toEqual([]);
    expect(processing.processorErrors).toEqual([]);
    expect(processing.policyViolations).toEqual([]);
    expect(processing.deadlineExpired).toBe(false);
    expect(processing.concatIdleObserved).toBe(true);
    expect(processing.concatStarted).toBe(true);
    expect(processing.concatFinished).toBe(true);
    expect(processing.firstPcm).not.toBeNull();
    expect(processing.rendered).not.toBeNull();
    expect(processing.rendered!.frames).toBe(8_192);
    expect(processing.rendered!.sampleRate).toBe(48_000);
    expect(processing.rendered!.tailMaxAbs).toBe(0);
    if (sessionSampleRate === 48_000) {
      expect(processing.firstPcm!.length).toBe(1_280);
      expect(processing.firstPcm!.minimum).toBe(8_191);
      expect(processing.firstPcm!.maximum).toBe(8_191);
      expect(processing.firstPcm!.nonzero).toBe(1_280);
      expect(processing.firstPcm!.rms).toBe(0.25);
      expect(processing.rendered!.earlyMaxError).toBe(0);
      expect(processing.rendered!.lateMaxError).toBe(0);
    } else {
      expect(processing.firstPcm!.length).toBeGreaterThanOrEqual(400);
      expect(processing.firstPcm!.length).toBeLessThanOrEqual(442);
      expect(Number.isFinite(processing.firstPcm!.rms)).toBe(true);
      expect(processing.firstPcm!.rms).toBeGreaterThan(0);
      expect(processing.firstPcm!.nonzero).toBeGreaterThan(0);
      expect(processing.rendered!.lateMaxError).toBeLessThanOrEqual(1 / 32_768);
    }
    expect(failedAssets).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrorCount).toBe(0);
    expect(voiceGrantPostCount).toBe(0);
    expect(providerSocketCount).toBe(0);
  } finally {
    page.off("requestfailed", onRequestFailed);
    page.off("request", onRequest);
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("websocket", onWebSocket);
    await page.unroute(FAKE_SUPABASE_SETTINGS, onFakeSupabaseSettings);
  }
}

test("Pub Pal's same-origin worklets execute matching-rate PCM under its real CSP", async ({ page }, testInfo) => {
  await exerciseWorklets(page, testInfo, 48_000);
});

test("Pub Pal's same-origin resampler converts PCM in both 16 kHz and 48 kHz directions", async ({ page }, testInfo) => {
  await exerciseWorklets(page, testInfo, 16_000);
});
