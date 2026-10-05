import type { Visibility } from "@/lib/spill";

// Honest, one-line copy per visibility lane (issue #24 / PRD "The Spill").
// Order matches VISIBILITIES so the segmented control and the allowlist never
// drift apart.
export const VISIBILITY_COPY: Record<Visibility, { label: string; helper: string }> = {
  public: { label: "Public", helper: "Everyone. The feed, map, and Ledger." },
  friends: { label: "Friends", helper: "You and people you follow who also follow you." },
  legacy: { label: "Legacy", helper: "Only you can read the note. Other readers see the Ledger entry without the note or price." },
  anonymous: { label: "Anonymous", helper: "Posted as a PUBMAXXER. Your handle is hidden." },
};

export const GENERATION_PRESETS = [
  { label: "Tonight", value: "Tonight" },
  { label: "Old memory", value: "Old memory" },
  { label: "Family story", value: "Family story" },
] as const;
