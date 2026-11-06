#!/usr/bin/env node
// Renders one of the two launch videos, its silent cut and its thumbnail, then
// checks the files with ffprobe.
//
// The renderer is not an app dependency (it pulls in webpack and a compositor
// binary no page needs), so it is installed once in a scratch folder at the
// same version as package.json's `remotion`, the same way as
// scripts/pubpal/render-pal-stage.mjs:
//
//   npm i --prefix /tmp/remotion-renderer @remotion/renderer@4.0.539 @remotion/bundler@4.0.539
//   REMOTION_RENDERER_DIR=/tmp/remotion-renderer node video/launch/render.mjs
//
// Options:
//   --cut launch|pal     which video (default launch; pal is the Pub Pal cut)
//   --out <dir>          where the files go (default video/launch/out)
//   --frames 0,75,140    also write those frames as PNG stills, for review
//   --frames-only        write only those stills (a quick look while editing)
//
// Writes <name>.mp4 (H.264, yuv420p, AAC), <name>-silent.mp4 (the same picture
// with no audio track) and <name>-thumbnail.png, where <name> is
// pubmaxx-launch or pubmaxx-pubpal.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

function option(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

const CUTS = {
  launch: { id: "PubmaxxLaunch", thumbnail: "PubmaxxLaunchThumbnail", name: "pubmaxx-launch" },
  pal: { id: "PubPalCut", thumbnail: "PubPalCutThumbnail", name: "pubmaxx-pubpal" },
};
const cut = CUTS[option("cut", "launch")];
if (!cut) {
  console.error(`--cut must be one of ${Object.keys(CUTS).join(", ")}.`);
  exit(2);
}
const out = resolve(option("out", join(HERE, "out")));
const frames = (option("frames", "") ?? "").split(",").filter(Boolean).map(Number);
const rendererDir = env.REMOTION_RENDERER_DIR;
if (!rendererDir) {
  console.error("Set REMOTION_RENDERER_DIR to the folder where @remotion/renderer and @remotion/bundler are installed.");
  exit(2);
}

const wanted = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies.remotion;
const fromRenderer = (name) => join(rendererDir, "node_modules", ...name.split("/"));
for (const name of ["@remotion/renderer", "@remotion/bundler"]) {
  const installed = JSON.parse(readFileSync(join(fromRenderer(name), "package.json"), "utf8")).version;
  if (installed !== wanted) {
    console.error(`${name} is ${installed}; the app's remotion is ${wanted}. Install the same version.`);
    exit(2);
  }
}
const load = (name) => import(pathToFileURL(join(fromRenderer(name), "dist", "index.js")).href);
const { bundle } = await load("@remotion/bundler");
const { renderMedia, renderStill, selectComposition } = await load("@remotion/renderer");

// The bundler aliases React to its own copy, which need not be the app's
// version, and React refuses two versions in one page. Every alias it sets is
// pointed back at the app's own copies, and `@` resolves as in tsconfig.json.
const appModule = (name) => join(ROOT, "node_modules", name);
const serveUrl = await bundle({
  entryPoint: join(HERE, "index.ts"),
  publicDir: join(HERE, "public"),
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

mkdirSync(out, { recursive: true });
// The Pal cut draws the 3D model with WebGL, so Chromium gets SwiftShader's
// GL, as for the Pal stage render.
const browser = {
  serveUrl,
  browserExecutable: env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
  chromiumOptions: { gl: "swangle" },
};

const video = join(out, `${cut.name}.mp4`);
const silent = join(out, `${cut.name}-silent.mp4`);
const thumbnail = join(out, `${cut.name}-thumbnail.png`);

const composition = await selectComposition({ ...browser, id: cut.id, inputProps: { muted: false } });

async function writeFrames() {
  for (const frame of frames) {
    const path = join(out, `${cut.name}-frame-${String(frame).padStart(3, "0")}.png`);
    await renderStill({ ...browser, composition, frame, output: path, imageFormat: "png", inputProps: { muted: true } });
    console.log(`wrote ${path}`);
  }
}

if (argv.includes("--frames-only")) {
  await writeFrames();
  exit(0);
}

await renderMedia({
  ...browser,
  composition,
  inputProps: { muted: false },
  codec: "h264",
  pixelFormat: "yuv420p",
  crf: 16,
  x264Preset: "slow",
  audioCodec: "aac",
  audioBitrate: "192k",
  colorSpace: "bt709",
  outputLocation: video,
  onProgress: ({ progress }) => {
    if (Math.round(progress * 100) % 25 === 0) process.stdout.write(`\rrendering ${Math.round(progress * 100)}%  `);
  },
});
console.log(`\nwrote ${video}`);

// The silent cut is the same picture with the audio track removed, so the two
// can never drift apart.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-map", "0:v:0", "-c", "copy", "-an", "-movflags", "+faststart", silent]);
console.log(`wrote ${silent}`);

const still = await selectComposition({ ...browser, id: cut.thumbnail });
await renderStill({ ...browser, composition: still, output: thumbnail, imageFormat: "png" });
console.log(`wrote ${thumbnail}`);

await writeFrames();

// The checks the post needs: the composition's length, 1080 x 1080, 30 fps,
// H.264 in yuv420p, AAC audio on the main file and no audio on the silent one.
function probe(file) {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { encoding: "utf8" }),
  );
}
const problems = [];
for (const [file, wantsAudio] of [[video, true], [silent, false]]) {
  const { streams, format } = probe(file);
  const picture = streams.find((stream) => stream.codec_type === "video");
  const sound = streams.find((stream) => stream.codec_type === "audio");
  const summary = {
    file: file.slice(out.length + 1),
    seconds: Number(format.duration).toFixed(3),
    size: `${picture?.width}x${picture?.height}`,
    fps: picture?.r_frame_rate,
    frames: picture?.nb_frames,
    video: `${picture?.codec_name} ${picture?.profile} ${picture?.pix_fmt}`,
    audio: sound ? `${sound.codec_name} ${sound.sample_rate} Hz ${sound.channels} ch` : "none",
    megabytes: (Number(format.size) / 1e6).toFixed(2),
  };
  console.log(summary);
  if (picture?.codec_name !== "h264") problems.push(`${summary.file}: video is ${picture?.codec_name}`);
  if (picture?.pix_fmt !== "yuv420p") problems.push(`${summary.file}: pixels are ${picture?.pix_fmt}`);
  if (picture?.width !== 1080 || picture?.height !== 1080) problems.push(`${summary.file}: size is ${summary.size}`);
  if (picture?.r_frame_rate !== "30/1") problems.push(`${summary.file}: frame rate is ${picture?.r_frame_rate}`);
  if (Number(picture?.nb_frames) !== composition.durationInFrames) problems.push(`${summary.file}: ${picture?.nb_frames} frames`);
  if (wantsAudio && sound?.codec_name !== "aac") problems.push(`${summary.file}: audio is ${sound?.codec_name ?? "missing"}`);
  if (!wantsAudio && sound) problems.push(`${summary.file}: has an audio track`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  exit(1);
}
console.log("All checks passed.");
