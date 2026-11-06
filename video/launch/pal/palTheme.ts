// The Pub Pal cut: timeline and words.
//
// The idea: every other app is built to sell you something. Here you hire an
// agent that works for you, it does the admin, and you go out. Every claim on
// screen is either the app's own behaviour, captured, or an approved line:
//
//   "Can't be bought."      docs/VOICE.md: "Nobody buys their way to the top."
//   "Pay: £0."              root AGENTS.md: a drinker pays for nothing.
//   "Shows its sources."    every Pal card prints its source and its date.
//   "Free for drinkers. Prices never for sale."  the launch kit's end card.

/** Scene slots in frames at 30 fps. Every cut lands on a bar (60 frames). */
export const PAL_SCENES = {
  hire: { from: 0, durationInFrames: 120 },
  chat: { from: 120, durationInFrames: 180 },
  admin: { from: 300, durationInFrames: 120 },
  out: { from: 420, durationInFrames: 60 },
  end: { from: 480, durationInFrames: 120 },
} as const;

export const PAL_VIDEO = { width: 1080, height: 1080, fps: 30, durationInFrames: 600 } as const;

export const PAL_COPY = {
  wanted: "WANTED",
  job: "Someone to sort tonight.",
  duties: ["Knows the listed pint prices.", "Shows its sources.", "Can't be bought.", "Pay: £0."],
  hired: "HIRED",
  ask: "Ask it like a mate.",
  receipts: "Every card shows its source.",
  admin: "It does the admin.",
  autoReply: "AUTO-REPLY",
  out: "Out of office.",
  outLine: "Your Pal does the admin. You do the night.",
  end: "Your Pub Pal works for you.",
  promise: "Free for drinkers. Prices never for sale.",
  url: "pubmaxxing.com",
} as const;

/**
 * The ticker: the Pal's four picks exactly as its cards print them, each with
 * its own source and the date that source was read (pal-screens.json).
 */
export const PAL_TICKER = [
  { pub: "THE LONDON AND SOUTH WESTERN", price: "£3.18", read: "2 OCT 2026" },
  { pub: "JUNCTION (CLAPHAM)", price: "£4.95", read: "4 JUL 2026" },
  { pub: "THE PHEONIX", price: "£5.00", read: "2 OCT 2026" },
  { pub: "EFFRA SOCIAL", price: "£4.20", read: "2 OCT 2026" },
] as const;
