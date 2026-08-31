"use client";

import { MessageSquareText, Mic } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  palGuestChatHref,
  writePalGuestChoice,
  type PalGuestMode,
} from "@/lib/palGuestTrial";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  PAL_LAUNCH_COPY,
  PAL_ONBOARDING_SPECIES,
  readPalOnboardingDraft,
  writePalOnboardingDraft,
} from "@/lib/pubPal";

type LandingPalSpecies = (typeof PAL_ONBOARDING_SPECIES)[number];
type LandingPalTarget = "pal_talk" | "pal_text";

const DEFAULT_PAL_PRIVACY = {
  proposeMemories: false,
  visible: true,
  muted: false,
} as const;

function isLandingPalSpecies(value: unknown): value is LandingPalSpecies {
  return PAL_ONBOARDING_SPECIES.includes(value as LandingPalSpecies);
}

function prepareGuestPal(species: LandingPalSpecies, mode: PalGuestMode): void {
  if (typeof window === "undefined") return;

  writePalGuestChoice(species, mode);

  const owner = anonymousPalDraftOwner();
  const existing = readPalOnboardingDraft(owner);
  const draft = existing?.draft ?? DEFAULT_PAL_DRAFT;
  writePalOnboardingDraft(owner, {
    step: existing?.step ?? 0,
    draft: {
      ...draft,
      appearance: { ...draft.appearance, species },
    },
    privacy: existing?.privacy ?? DEFAULT_PAL_PRIVACY,
  });
}

export default function LandingPalEntry({
  onTarget,
}: {
  onTarget: (target: LandingPalTarget) => void;
}) {
  const [species, setSpecies] = useState<LandingPalSpecies | null>(null);
  const [voiceAllowed, setVoiceAllowed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const existing = readPalOnboardingDraft(anonymousPalDraftOwner());
      if (isLandingPalSpecies(existing?.draft.appearance.species)) {
        setSpecies(existing.draft.appearance.species);
      } else {
        setSpecies("robin");
      }
      setVoiceAllowed(existing?.privacy.muted !== true);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const begin = (mode: PalGuestMode) => {
    if (!ready || !species) return;
    prepareGuestPal(species, mode);
    onTarget(mode === "talk" ? "pal_talk" : "pal_text");
  };

  return (
    <fieldset className="lpPalEntry">
      <legend>Choose your Pal</legend>
      <div className="lpPalChoices">
        {PAL_ONBOARDING_SPECIES.map((candidate) => (
          <button
            className="lpPalChoice"
            type="button"
            aria-pressed={species === candidate}
            disabled={!ready}
            key={candidate}
            onClick={() => setSpecies(candidate)}
          >
            {PAL_LAUNCH_COPY[candidate].title}
          </button>
        ))}
      </div>
      <div className="lpPalEntryModes">
        {ready && species && voiceAllowed ? (
          <Link
            prefetch={false}
            className="lpPalEntryMode lpPalModeTalk"
            href={palGuestChatHref(species, "talk")}
            onClick={() => begin("talk")}
          >
            <Mic size={17} aria-hidden="true" /> Talk
          </Link>
        ) : null}
        {ready && species ? (
          <Link
            prefetch={false}
            className="lpPalEntryMode lpPalModeText"
            href={palGuestChatHref(species, "text")}
            onClick={() => begin("text")}
          >
            <MessageSquareText size={17} aria-hidden="true" /> Text
          </Link>
        ) : null}
      </div>
    </fieldset>
  );
}
