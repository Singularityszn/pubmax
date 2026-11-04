#!/usr/bin/env node
// Render the Pal stage (components/pal/PalStage.tsx) to an MP4 with Remotion:
// a Pal's real artwork turning, breathing and blinking, and talking when a
// voice line is given. With no voice it renders a 6-second silent loop.
//
// The renderer is not an app dependency: it pulls in webpack and a 27 MB
// compositor binary that no page needs. Install it once in a scratch folder,
// at the same version as package.json's `remotion`, and point at it:
//
//   npm i --prefix /tmp/remotion-renderer @remotion/renderer@4.0.536 @remotion/bundler@4.0.536
//   REMOTION_RENDERER_DIR=/tmp/remotion-renderer npm run pubpal:stage -- fox out.mp4 [voice.mp3]
//
// The voice line (an ElevenLabs take, say) opens the mouth frame by frame: its
// loudness per frame, scaled to the take's own loud end, then eased like the
// live face (usePalHead3D): fast to open, slower to shut. The line starts half
// a second in, and the audio is laid under the video. Chromium is the one
// Playwright installed (PLAYWRIGHT_CHROMIUM or /opt/pw-browsers/chromium).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FPS = 30;
const SIDE = 720;
const LOOP_FRAMES = 6 * FPS;
const LEAD_SECONDS = 0.5;

const [slug, out, voicePath] = argv.slice(2);
const rendererDir = env.REMOTION_RENDERER_DIR;
if (!slug || !out || !rendererDir) {
  console.error("Usage: REMOTION_RENDERER_DIR=<dir> render-pal-stage.mjs <slug> <out.mp4> [voice.mp3]");
  exit(2);
}

const wanted = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies.remotion;
const fromRenderer = (name) => join(rendererDir, "node_modules", ...name.split("/"));
const installed = JSON.parse(readFileSync(join(fromRenderer("@remotion/renderer"), "package.json"), "utf8")).version;
if (installed !== wanted) {
  console.error(`@remotion/renderer is ${installed}; the app's remotion is ${wanted}. Install the same version.`);
  exit(2);
}
const load = (name) => import(pathToFileURL(join(fromRenderer(name), "dist", "index.js")).href);
const { bundle } = await load("@remotion/bundler");
const { renderMedia, selectComposition } = await load("@remotion/renderer");

/** The mouth level for each frame of the voice line, 0 to 1. */
function voiceLevels(file) {
  const rate = 48000;
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], {
    maxBuffer: 1 << 28,
  });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const perFrame = rate / FPS;
  const lead = Math.round(LEAD_SECONDS * FPS);
  const frames = lead + Math.ceil(samples.length / perFrame) + lead;
  const rms = Array.from({ length: frames }, (_, frame) => {
    const start = (frame - lead) * perFrame;
    if (start < 0 || start >= samples.length) return 0;
    let sum = 0;
    const end = Math.min(samples.length, start + perFrame);
    for (let i = start; i < end; i += 1) sum += (samples[i] / 32768) ** 2;
    return Math.sqrt(sum / (end - start));
  });
  const loud = [...rms].filter((value) => value > 0.01).sort((a, b) => a - b);
  const top = loud[Math.floor(loud.length * 0.95)] ?? 1;
  let level = 0;
  return rms.map((value) => {
    const target = Math.min(1, Math.max(0, (value / top - 0.12) * 1.6));
    level += (target - level) * (target > level ? 0.6 : 0.35);
    return Math.round(level * 1000) / 1000;
  });
}

const voice = voicePath ? voiceLevels(voicePath) : [];
const durationInFrames = Math.max(LOOP_FRAMES, voice.length);

// The entry is written fresh each run, so the repo holds no Remotion root that
// the app's typecheck would have to resolve the renderer for.
const scratch = mkdtempSync(join(tmpdir(), "pal-stage-"));
const entryPoint = join(scratch, "index.jsx");
writeFileSync(
  entryPoint,
  `import { Composition, registerRoot } from "remotion";
import PalStage from "@/components/pal/PalStage";
registerRoot(() => (
  <Composition id="PalStage" component={PalStage} fps={${FPS}} width={${SIDE}} height={${SIDE}}
    durationInFrames={${durationInFrames}} defaultProps={{ slug: "fox", voice: [] }} />
));
`,
);

// The bundler aliases React to ITS copy (the scratch folder's), which need not
// be the app's version; React refuses two versions in one page, so every
// alias it sets is pointed back at the app's own copies.
const appModule = (name) => join(ROOT, "node_modules", name);
const serveUrl = await bundle({
  entryPoint,
  publicDir: join(ROOT, "public"),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        "@": ROOT,
        react: appModule("react"),
        "react/jsx-runtime": appModule("react/jsx-runtime.js"),
        "react/jsx-dev-runtime": appModule("react/jsx-dev-runtime.js"),
        "react-dom": appModule("react-dom"),
        "react-dom/client": appModule("react-dom/client.js"),
        remotion: appModule("remotion"),
      },
    },
  }),
});

const inputProps = { slug, voice };
const options = {
  serveUrl,
  inputProps,
  browserExecutable: env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
  chromiumOptions: { gl: "swangle" },
};
const composition = await selectComposition({ ...options, id: "PalStage" });
const silent = voicePath ? join(scratch, "silent.mp4") : resolve(out);
await renderMedia({ ...options, composition, codec: "h264", crf: 18, outputLocation: silent });

if (voicePath) {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", silent, "-i", voicePath,
    "-af", `adelay=${LEAD_SECONDS * 1000}:all=1`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", resolve(out),
  ]);
}
console.log(`wrote ${out} (${durationInFrames} frames)`);
