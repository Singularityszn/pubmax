// One place for the launch video's colours, type and timeline.
//
// The colours are the brief's four brand colours. They match the app tokens:
// coral is --brass, warm paper is the light page floor, deep night is the dark
// page floor and amber is --amber (app/globals.css, app/theme.css).

export const COLOURS = {
  coral: "#ff5a5f",
  paper: "#f8f2ec",
  night: "#0a0a0b",
  amber: "#f0a01a",
  /** Paper at reduced strength, for supporting lines on the night ground. */
  paperMuted: "rgba(248, 242, 236, 0.72)",
  /** A raised surface on the night ground (chat bubbles, panels). */
  nightRaised: "#1b1a1d",
} as const;

export const FONTS = {
  headline: "'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
} as const;

export const VIDEO = {
  width: 1080,
  height: 1080,
  fps: 30,
  durationInFrames: 450,
} as const;

/**
 * Where each scene starts and how long it runs, in frames at 30 fps. Every cut
 * lands on a bar line of the music bed (one bar is 60 frames at 120 BPM).
 */
export const SCENES = {
  hook: { from: 0, durationInFrames: 60 },
  find: { from: 60, durationInFrames: 120 },
  plan: { from: 180, durationInFrames: 120 },
  share: { from: 300, durationInFrames: 60 },
  end: { from: 360, durationInFrames: 90 },
} as const;

/** The overlap, in frames, while one scene hands over to the next. */
export const HANDOVER = 10;

/** Key text, exactly as the brief supplies it. */
export const COPY = {
  chat: ["Pub?", "Which one?", "Who's coming?"],
  find: "Find your next pub.",
  plan: "Build the plan.",
  share: "Send it to the group.",
  end: "Make tonight happen.",
  url: "pubmaxxing.com",
  idea: "Turn the group chat into a night out.",
} as const;
