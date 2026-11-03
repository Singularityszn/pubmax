#!/usr/bin/env node
// Writes every sound the launch video uses into video/launch/public/audio.
//
// Nothing here is sampled or downloaded. Each sound is synthesised from sine
// waves and seeded noise, so the audio is original work with no third-party
// licence to track, and a run always writes the same bytes.
//
//   node video/launch/make-audio.mjs
//
// The music bed is 15 seconds at 120 BPM, so one bar is 2 seconds (60 frames
// at 30 fps) and every scene cut in LaunchVideo.tsx lands on a bar line. The
// short effects are placed on the timeline by the composition itself, so a
// cue can move in Remotion Studio without running this script again.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "public", "audio");
const RATE = 48000;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const LENGTH_SECONDS = 15;

/** A small seeded generator, so the noise is the same on every run. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midi = (note) => 440 * 2 ** ((note - 69) / 12);

/** A stereo buffer: two Float32Arrays of the same length. */
function buffer(seconds) {
  const length = Math.ceil(seconds * RATE);
  return [new Float32Array(length), new Float32Array(length)];
}

/** Adds a mono voice into a stereo buffer at a time, gain and pan (-1 to 1). */
function mix(target, voice, at, gain = 1, pan = 0) {
  const start = Math.round(at * RATE);
  const left = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const right = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < voice.length; i += 1) {
    const j = start + i;
    if (j < 0 || j >= target[0].length) continue;
    target[0][j] += voice[i] * left;
    target[1][j] += voice[i] * right;
  }
}

/** A soft electric-piano note: a few sine partials with a gentle tremolo. */
function keys(frequency, seconds) {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  const partials = [
    [1, 1, 1.4],
    [2, 0.28, 2.6],
    [3, 0.07, 4],
    [4.01, 0.035, 6],
  ];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.008);
    const release = Math.min(1, (seconds - t) / 0.12);
    const tremolo = 1 + 0.06 * Math.sin(2 * Math.PI * 4.6 * t);
    let sample = 0;
    for (const [ratio, level, decay] of partials) {
      sample += level * Math.exp(-decay * t) * Math.sin(2 * Math.PI * frequency * ratio * t);
    }
    out[i] = sample * attack * Math.max(0, release) * tremolo;
  }
  return out;
}

/** A round sub bass note. */
function bass(frequency, seconds) {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.01) * Math.exp(-1.1 * t) * Math.max(0, Math.min(1, (seconds - t) / 0.06));
    out[i] = env * (Math.sin(2 * Math.PI * frequency * t) + 0.18 * Math.sin(4 * Math.PI * frequency * t));
  }
  return out;
}

function kick() {
  const out = new Float32Array(Math.ceil(0.35 * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const frequency = 46 + 90 * Math.exp(-t * 32);
    phase += (2 * Math.PI * frequency) / RATE;
    out[i] = Math.sin(phase) * Math.exp(-t * 9) * Math.min(1, t / 0.002);
  }
  return out;
}

/** Noise through a one-pole high-pass, short and bright. */
function hat(random, seconds = 0.05) {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  let previous = 0;
  let filtered = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const noise = random() * 2 - 1;
    filtered = 0.86 * (filtered + noise - previous);
    previous = noise;
    out[i] = filtered * Math.exp(-t * 70);
  }
  return out;
}

/** A soft finger snap: band-limited noise with a quick body. */
function snap(random) {
  const out = new Float32Array(Math.ceil(0.18 * RATE));
  let low = 0;
  let previous = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const noise = random() * 2 - 1;
    low += 0.35 * (noise - low);
    const band = low - previous;
    previous = low;
    out[i] = band * 3 * Math.exp(-t * 28) + 0.25 * Math.sin(2 * Math.PI * 1850 * t) * Math.exp(-t * 60);
  }
  return out;
}

/** A message notification: two quick sine blips, the second a fifth higher. */
function pop(frequency) {
  const seconds = 0.42;
  const out = new Float32Array(Math.ceil(seconds * RATE));
  const blip = (t, f) => {
    if (t < 0) return 0;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 22);
    const bend = f * (1 + 0.04 * Math.exp(-t * 60));
    return env * (Math.sin(2 * Math.PI * bend * t) + 0.2 * Math.sin(4 * Math.PI * bend * t));
  };
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    out[i] = 0.75 * blip(t, frequency) + 0.6 * blip(t - 0.07, frequency * 1.5);
  }
  return out;
}

/** A small UI tap: a click of noise over a high sine tick. */
function click(random) {
  const out = new Float32Array(Math.ceil(0.06 * RATE));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    out[i] = (0.5 * (random() * 2 - 1) * Math.exp(-t * 900) + 0.6 * Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 140));
  }
  return out;
}

/** A soft air whoosh that rises into a cut and falls away after it. */
function whoosh(random, seconds = 0.5) {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  let low = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const x = t / seconds;
    const cutoff = 0.02 + 0.22 * Math.sin(Math.PI * x);
    low += cutoff * (random() * 2 - 1 - low);
    out[i] = low * Math.sin(Math.PI * x) ** 2 * 2.2;
  }
  return out;
}

/** The end-card chime: a bell made of three inharmonic partials. */
function chime() {
  const seconds = 2.4;
  const out = new Float32Array(Math.ceil(seconds * RATE));
  const notes = [midi(84), midi(91)];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    let sample = 0;
    notes.forEach((f, n) => {
      const local = t - n * 0.09;
      if (local < 0) return;
      const env = Math.min(1, local / 0.003) * Math.exp(-local * 2.2);
      sample += env * (Math.sin(2 * Math.PI * f * local) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * local) * Math.exp(-local * 6));
    });
    out[i] = sample * 0.5;
  }
  return out;
}

/** Normalises a stereo buffer to a peak and writes 16-bit PCM WAV. */
function writeWav(name, stereo, peak = 0.89) {
  let max = 0;
  for (const channel of stereo) for (const sample of channel) max = Math.max(max, Math.abs(sample));
  const scale = max > 0 ? peak / max : 1;
  const frames = stereo[0].length;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < 2; c += 1) {
      const value = Math.max(-1, Math.min(1, stereo[c][i] * scale));
      data.writeInt16LE(Math.round(value * 32767), i * 4 + c * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(OUT, name), Buffer.concat([header, data]));
  console.log(`wrote ${name}`);
}

/** One short effect in its own file, centred. */
function effect(name, voice, peak) {
  const stereo = [new Float32Array(voice), new Float32Array(voice)];
  writeWav(name, stereo, peak);
}

// THE MUSIC BED. Bar 0 (0-2 s) is the hook: drums and the chat pops only.
// Bars 1 to 5 (2-12 s) carry the chords under the three product scenes. From
// 12 s the end card rests on one held chord, with no drums, and fades out.
function musicBed() {
  const random = seeded(20261104);
  const out = buffer(LENGTH_SECONDS);
  const chords = [
    { bass: 41, notes: [57, 60, 64, 67] }, // Fmaj9
    { bass: 40, notes: [55, 59, 62, 64] }, // Em7
    { bass: 45, notes: [60, 64, 67, 71] }, // Am9
    { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
    { bass: 43, notes: [53, 57, 60, 62] }, // G9sus
  ];
  const kickVoice = kick();
  const snapVoice = snap(random);

  for (let bar = 0; bar < 6; bar += 1) {
    const at = bar * BAR;
    for (let beat = 0; beat < 4; beat += 1) {
      const t = at + beat * BEAT;
      // The hook bar runs four on the floor; the scenes settle to one and three.
      if (bar === 0 || beat % 2 === 0) mix(out, kickVoice, t, 0.6);
      if (bar > 0 && beat % 2 === 1) mix(out, snapVoice, t, 0.32, 0.1);
      for (let eighth = 0; eighth < 2; eighth += 1) {
        mix(out, hat(random), t + eighth * (BEAT / 2), eighth ? 0.16 : 0.1, eighth ? 0.35 : -0.35);
      }
    }
    const chord = chords[bar - 1];
    if (!chord) continue;
    const hits = [
      [0, BEAT * 2.4],
      [BEAT * 2.5, BEAT * 1.4],
    ];
    for (const [offset, length] of hits) {
      chord.notes.forEach((note, n) => {
        mix(out, keys(midi(note), length), at + offset + n * 0.006, 0.16, -0.3 + n * 0.2);
      });
    }
    mix(out, bass(midi(chord.bass), BEAT * 2.2), at, 0.55);
    mix(out, bass(midi(chord.bass + 12), BEAT * 1.2), at + BEAT * 2.5, 0.3);
  }

  // The end card: Cmaj9 held from 12 s, one last soft kick under it.
  const end = 6 * BAR;
  mix(out, kickVoice, end, 0.5);
  [52, 55, 59, 62, 64].forEach((note, n) => {
    mix(out, keys(midi(note), LENGTH_SECONDS - end), end + n * 0.01, 0.15, -0.4 + n * 0.2);
  });
  mix(out, bass(midi(36), 2.6), end, 0.55);

  // Fade the last 1.2 seconds so the file ends in silence.
  const fadeFrom = Math.round((LENGTH_SECONDS - 1.2) * RATE);
  for (let i = fadeFrom; i < out[0].length; i += 1) {
    const gain = 1 - (i - fadeFrom) / (out[0].length - fadeFrom);
    out[0][i] *= gain;
    out[1][i] *= gain;
  }
  return out;
}

/** A rubber stamp: a low thud under a short slap of paper. */
function stamp(random) {
  const out = new Float32Array(Math.ceil(0.5 * RATE));
  let phase = 0;
  let low = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    phase += (2 * Math.PI * (52 + 70 * Math.exp(-t * 40))) / RATE;
    low += 0.25 * (random() * 2 - 1 - low);
    out[i] = Math.sin(phase) * Math.exp(-t * 14) + low * 2.4 * Math.exp(-t * 55);
  }
  return out;
}

// THE PAL CUT'S BED: 20 seconds, the same 120 BPM, one bar a scene step.
//   bars 0-1  the job advert: short office-ish stabs on the off-beat
//   bars 2-6  the Pal at work: the chords and bass of the launch bed
//   bar 7     out of office: one big chord and a walking bass
//   bars 8-9  the end card: two held chords, no drums after the first beat
function palMusicBed() {
  const seconds = 20;
  const random = seeded(20261105);
  const out = buffer(seconds);
  const kickVoice = kick();
  const snapVoice = snap(random);
  const stabs = [
    { bass: 36, notes: [55, 59, 62, 64] }, // Cmaj9
    { bass: 45, notes: [55, 60, 64, 67] }, // Am9
  ];
  const work = [
    { bass: 41, notes: [57, 60, 64, 67] }, // Fmaj9
    { bass: 40, notes: [55, 59, 62, 64] }, // Em7
    { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
    { bass: 45, notes: [60, 64, 67, 71] }, // Am9
    { bass: 43, notes: [53, 57, 60, 62] }, // G9sus
  ];
  const drums = (at) => {
    for (let beat = 0; beat < 4; beat += 1) {
      const t = at + beat * BEAT;
      if (beat % 2 === 0) mix(out, kickVoice, t, 0.6);
      else mix(out, snapVoice, t, 0.32, 0.1);
      for (let eighth = 0; eighth < 2; eighth += 1) {
        mix(out, hat(random), t + eighth * (BEAT / 2), eighth ? 0.16 : 0.1, eighth ? 0.35 : -0.35);
      }
    }
  };
  const chordAt = (chord, at, length, gain = 0.16) => {
    chord.notes.forEach((note, n) => mix(out, keys(midi(note), length), at + n * 0.006, gain, -0.3 + n * 0.2));
  };

  stabs.forEach((chord, bar) => {
    const at = bar * BAR;
    drums(at);
    for (let beat = 0; beat < 4; beat += 1) chordAt(chord, at + beat * BEAT + BEAT / 2, 0.16, 0.2);
    mix(out, bass(midi(chord.bass), BEAT * 0.9), at, 0.5);
    mix(out, bass(midi(chord.bass), BEAT * 0.9), at + BEAT * 2, 0.4);
  });
  work.forEach((chord, index) => {
    const at = (index + 2) * BAR;
    drums(at);
    chordAt(chord, at, BEAT * 2.4);
    chordAt(chord, at + BEAT * 2.5, BEAT * 1.4);
    mix(out, bass(midi(chord.bass), BEAT * 2.2), at, 0.55);
    mix(out, bass(midi(chord.bass + 12), BEAT * 1.2), at + BEAT * 2.5, 0.3);
  });
  const outOfOffice = 7 * BAR;
  drums(outOfOffice);
  chordAt({ notes: [52, 55, 59, 62, 64] }, outOfOffice, BAR, 0.18);
  [36, 40, 43, 45].forEach((note, beat) => mix(out, bass(midi(note), BEAT * 0.9), outOfOffice + beat * BEAT, 0.5));
  const end = 8 * BAR;
  mix(out, kickVoice, end, 0.5);
  chordAt({ notes: [57, 60, 64, 67] }, end, BAR, 0.15);
  mix(out, bass(midi(41), BAR), end, 0.5);
  chordAt({ notes: [52, 55, 59, 62, 64] }, end + BAR, seconds - end - BAR, 0.15);
  mix(out, bass(midi(36), 1.8), end + BAR, 0.5);

  const fadeFrom = Math.round((seconds - 1.2) * RATE);
  for (let i = fadeFrom; i < out[0].length; i += 1) {
    const gain = 1 - (i - fadeFrom) / (out[0].length - fadeFrom);
    out[0][i] *= gain;
    out[1][i] *= gain;
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
writeWav("music-bed.wav", musicBed(), 0.8);
writeWav("pal-music-bed.wav", palMusicBed(), 0.8);
effect("stamp.wav", stamp(seeded(23)), 0.7);
// The three chat pops climb, one per bubble.
effect("pop-1.wav", pop(midi(83)), 0.6);
effect("pop-2.wav", pop(midi(86)), 0.6);
effect("pop-3.wav", pop(midi(88)), 0.6);
effect("click.wav", click(seeded(7)), 0.45);
effect("whoosh.wav", whoosh(seeded(11)), 0.35);
effect("chime.wav", chime(), 0.5);
