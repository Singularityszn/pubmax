import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const targetDir = join(projectRoot, "public", "vendor", "elevenlabs");
const clientWorklets = join(
  projectRoot,
  "node_modules",
  "@elevenlabs",
  "client",
  "worklets",
);

// Filenames match lib/elevenlabsWorkletAssets.ts. The processors come from the
// hoisted @elevenlabs/client that @elevenlabs/react already installs.
// libsamplerate is the 2.1.2 build that client falls back to, pinned here.
const copies = [
  [join(clientWorklets, "rawAudioProcessor.js"), "raw-audio-processor.js"],
  [join(clientWorklets, "audioConcatProcessor.js"), "audio-concat-processor.js"],
  [
    require.resolve(
      "@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js",
    ),
    "libsamplerate.worklet.js",
  ],
];

await mkdir(targetDir, { recursive: true });
await Promise.all(
  copies.map(([source, name]) => copyFile(source, join(targetDir, name))),
);

console.log(`Copied ElevenLabs worklets to ${targetDir}`);
