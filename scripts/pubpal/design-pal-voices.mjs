#!/usr/bin/env node
// Design and save one ElevenLabs voice per Pub Pal onboarding species.
// Requires ELEVENLABS_API_KEY. See docs/PUB_PAL_SETUP.md.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DESIGN_URL = "https://api.elevenlabs.io/v1/text-to-voice/design";
const CREATE_URL = "https://api.elevenlabs.io/v1/text-to-voice";
const PREVIEW_TEXT =
  "Where is a cheap pint near Soho tonight? I need somewhere quiet enough to hear myself think, and I would like to be on the last train home.";

const SPECIES = ["robin", "greyhound", "cat", "fox", "pigeon", "badger", "corgi"];

const VOICE_DESCRIPTIONS = {
  robin:
    "A warm British female voice in her late twenties. Measured, grounded, reads the room. Soft London accent, unhurried pub-companion pace.",
  greyhound:
    "A calm British male voice in his early thirties. Loyal, gentle baritone. Speaks like a mate who already knows the route.",
  cat:
    "A dry British female voice in her mid thirties. Half-lidded warmth, dry wit kept spare. Clear consonants, never shrill.",
  fox:
    "A quick British female voice in her late twenties. Alert, curious, spots the sensible exit. Light brightness without cartoon.",
  pigeon:
    "A streetwise British male voice in his thirties. Side-eye humour, knows the last buses. Urban London, confident but not loud.",
  badger:
    "A steady British male voice in his forties. Reassuring low register, planted and square. Lantern-steady calm for late nights.",
  corgi:
    "A bright British female voice in her mid twenties. Eager grin in the tone without shouting. Crew-mate energy, celebrates the plan.",
};

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function envKeyForSpecies(species) {
  return `ELEVENLABS_VOICE_${species.replace(/-/g, "_").toUpperCase()}`;
}

async function designPreview(apiKey, description) {
  const response = await fetch(DESIGN_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      voice_description: description,
      text: PREVIEW_TEXT,
      auto_generate_text: false,
      model_id: "eleven_multilingual_ttv_v2",
    }),
  });
  const text = await response.text();
  if (!response.ok) fail(`Voice design answered ${response.status}: ${text.slice(0, 400)}`);
  const payload = JSON.parse(text);
  const preview = payload.previews?.[0];
  if (!preview?.generated_voice_id) fail("Voice design returned no preview id.");
  return preview;
}

async function saveVoice(apiKey, species, description, generatedVoiceId) {
  const response = await fetch(CREATE_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      voice_name: `PUBMAXX Pub Pal ${species}`,
      voice_description: description,
      generated_voice_id: generatedVoiceId,
    }),
  });
  const text = await response.text();
  if (!response.ok) fail(`Save voice answered ${response.status}: ${text.slice(0, 400)}`);
  const payload = JSON.parse(text);
  const voiceId = payload.voice_id ?? payload.voiceId;
  if (!voiceId) fail("Save voice returned no voice_id.");
  return voiceId;
}

async function main() {
  loadDotEnv();
  const dryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!dryRun && !apiKey) fail("ELEVENLABS_API_KEY is not set. See docs/PUB_PAL_SETUP.md.");

  const selected = arg("species", SPECIES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const species of selected) {
    if (!SPECIES.includes(species)) fail(`Unknown species: ${species}`);
  }

  const outDir = path.join(process.cwd(), "docs/proof/pubpal-voices");
  mkdirSync(outDir, { recursive: true });
  const envLines = [];

  for (const species of selected) {
    const description = VOICE_DESCRIPTIONS[species];
    console.log(`\n— ${species} —`);
    if (dryRun) {
      console.log(description);
      continue;
    }
    const preview = await designPreview(apiKey, description);
    const voiceId = await saveVoice(apiKey, species, description, preview.generated_voice_id);
    envLines.push(`${envKeyForSpecies(species)}=${voiceId}`);
    console.log(`  saved → ${envKeyForSpecies(species)}`);
    if (preview.audio_base_64) {
      const audioPath = path.join(outDir, `${species}-preview.mp3`);
      writeFileSync(audioPath, Buffer.from(preview.audio_base_64, "base64"));
    }
  }

  if (!dryRun && envLines.length > 0) {
    const envPath = path.join(outDir, "elevenlabs-voice-ids.env");
    writeFileSync(envPath, `${envLines.join("\n")}\n`);
    console.log("\nDeployment env lines:\n" + envLines.join("\n"));
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
