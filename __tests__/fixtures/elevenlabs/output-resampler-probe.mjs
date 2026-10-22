// Executes the installed SDK. Only device APIs and the network transport are
// synthetic. Node's load hook applies the loader selected by the actual config;
// an unconfigured baseline loads the original SDK, so it fails on the CDN URL.
import { createRequire, registerHooks } from "node:module";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [bundler, scenario] = process.argv.slice(2);
const root = process.cwd();
const require = createRequire(import.meta.url);
const sdkRelativePath = "node_modules/@elevenlabs/client/dist/platform/web/VoiceSessionSetup.js";
const setupPath = path.join(root, sdkRelativePath);
const setupUrl = pathToFileURL(realpathSync(setupPath)).href;
const config = (await import(pathToFileURL(path.join(root, "next.config.mjs")).href)).default;
let loaders = [];
if (bundler === "turbopack") {
  loaders = config.turbopack?.rules?.[sdkRelativePath]?.loaders ?? [];
} else if (bundler === "webpack") {
  const webpackConfig = config.webpack
    ? config.webpack({ module: { rules: [] } }, { isServer: false })
    : { module: { rules: [] } };
  loaders = webpackConfig.module.rules
    .filter((rule) => rule.test?.test(setupPath) && (!rule.include || setupPath === rule.include))
    .flatMap((rule) => rule.use ?? []);
} else {
  throw new Error(`Unknown bundler ${bundler}`);
}
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== setupUrl) return loaded;
    let source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    for (const entry of loaders) {
      const loader = require(typeof entry === "string" ? entry : entry.loader);
      source = loader.call({ resourcePath: fileURLToPath(url) }, source);
    }
    return { ...loaded, source };
  },
});

const modules = [];
const contexts = [];
const tracks = [];
const audioElements = [];
let socketCloseCalls = 0;
let wakeReleases = 0;
let webRtcCreates = 0;
let webRtcControllersRetained = null;
const node = () => ({ connect() {}, disconnect() {}, frequencyBinCount: 16 });
const permission = new EventTarget();
class DeviceContext {
  constructor(options = {}) {
    this.index = contexts.length;
    this.sampleRate = scenario === "unsupported-rate" ||
      (this.index === 1 && ["mismatched-rate", "processor-refusal"].includes(scenario))
      ? 48_000 : options.sampleRate;
    this.state = "running";
    this.closeCalls = 0;
    this.audioWorklet = {
      addModule: async (url) => {
        modules.push({ context: this.index, url });
        if (!url.startsWith("/vendor/elevenlabs/")) throw new Error(`CSP refused external worklet ${url}`);
        if (scenario === "processor-refusal" && url.endsWith("audio-concat-processor.js")) {
          throw new Error("synthetic output processor refusal");
        }
      },
    };
    contexts.push(this);
  }
  createAnalyser() { return node(); }
  createGain() { return { ...node(), gain: { value: 1 } }; }
  createMediaStreamDestination() { return { ...node(), stream: {} }; }
  createMediaStreamSource() { return node(); }
  async resume() { this.state = "running"; }
  async close() { this.closeCalls += 1; this.state = "closed"; }
}
class DeviceWorklet {
  constructor() {
    this.port = Object.assign(new EventTarget(), { start() {}, postMessage() {} });
  }
  connect() {}
  disconnect() {}
}
class DeviceAudio {
  style = {};
  parentNode = null;
  load() {}
  pause() {}
}
const document = Object.assign(new EventTarget(), {
  visibilityState: "visible",
  body: {
    appendChild(element) { audioElements.push(element); element.parentNode = this; },
    removeChild(element) { audioElements.splice(audioElements.indexOf(element), 1); element.parentNode = null; },
  },
});
const navigator = {
  platform: "Linux",
  userAgent: "Synthetic audio device",
  permissions: { query: async () => permission },
  wakeLock: { request: async () => ({ release: async () => { wakeReleases += 1; } }) },
  mediaDevices: {
    getSupportedConstraints: () => ({ sampleRate: scenario !== "unsupported-rate" }),
    getUserMedia: async () => {
      const track = { stops: 0, stop() { this.stops += 1; } };
      tracks.push(track);
      return { getTracks: () => [track] };
    },
  },
};
class NetworkSocket extends EventTarget {
  constructor(url) {
    super();
    if (!url.startsWith("wss://voice.example.invalid/")) throw new Error("Unexpected network address");
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send() {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "conversation_initiation_metadata",
        conversation_initiation_metadata_event: {
          conversation_id: "synthetic-conversation",
          user_input_audio_format: "pcm_16000",
          agent_output_audio_format: "pcm_16000",
        },
      }),
    })));
  }
  close() { socketCloseCalls += 1; }
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
Object.assign(globalThis, {
  document, window: { navigator, AudioContext: DeviceContext },
  AudioContext: DeviceContext, AudioWorkletNode: DeviceWorklet,
  Audio: DeviceAudio, WebSocket: NetworkSocket,
  fetch: async () => { throw new Error("Unexpected network fetch"); },
});

// For RTC only, replace the network establishment boundary, retaining the real
// SDK class identity and the real setupWebRTCSession dispatch/controller logic.
let rtcConnection;
if (scenario === "webrtc") {
  const rtcUrl = pathToFileURL(path.join(root, "node_modules/@elevenlabs/client/dist/utils/WebRTCConnection.js")).href;
  const { WebRTCConnection } = await import(rtcUrl);
  rtcConnection = Object.assign(Object.create(WebRTCConnection.prototype), {
    input: { close: async () => {} }, output: { close: async () => {} }, close() {},
  });
  WebRTCConnection.create = async () => { webRtcCreates += 1; return rtcConnection; };
}
const { webSessionSetup } = await import(setupUrl);
let error = null;
try {
  const options = {
    workletPaths: {
      rawAudioProcessor: "/vendor/elevenlabs/raw-audio-processor.js",
      audioConcatProcessor: "/vendor/elevenlabs/audio-concat-processor.js",
    },
    libsampleratePath: "/vendor/elevenlabs/libsamplerate.worklet.js",
  };
  const result = await webSessionSetup(scenario === "webrtc"
    ? { ...options, conversationToken: "synthetic-network-token", connectionType: "webrtc" }
    : { ...options, signedUrl: "wss://voice.example.invalid/session", connectionType: "websocket" });
  if (scenario === "webrtc") {
    webRtcControllersRetained = result.connection === rtcConnection &&
      result.input === rtcConnection.input && result.output === rtcConnection.output &&
      result.playbackEventTarget === null;
  }
  await result.detach();
  await result.input.close();
  await result.output.close();
  result.connection.close();
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
console.log(JSON.stringify({
  error, modules,
  contexts: contexts.map(({ sampleRate, closeCalls }) => ({ sampleRate, closeCalls })),
  trackStops: tracks.map((track) => track.stops),
  audioElementsRemaining: audioElements.length,
  socketCloseCalls, wakeReleases, webRtcControllersRetained, webRtcCreates,
}));
