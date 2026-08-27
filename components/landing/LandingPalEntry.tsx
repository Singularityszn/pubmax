"use client";

import { MessageCircle, Mic } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import PalPortrait from "@/components/pal/PalPortrait";
import {
  palGuestChatHref,
  type PalGuestInputMode,
  writePalGuestChoice,
} from "@/lib/palGuestTrial";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  PAL_LAUNCH_COPY,
  PAL_ONBOARDING_SPECIES,
  type PubPalSpecies,
  writePalOnboardingDraft,
} from "@/lib/pubPal";

type LaunchPalSpecies = (typeof PAL_ONBOARDING_SPECIES)[number];

function prepareGuestPal(species: LaunchPalSpecies, mode: PalGuestInputMode): void {
  if (typeof window === "undefined") return;

  writePalGuestChoice(window.localStorage, species, mode);
  writePalOnboardingDraft(anonymousPalDraftOwner(), {
    step: 0,
    draft: {
      ...DEFAULT_PAL_DRAFT,
      appearance: { ...DEFAULT_PAL_DRAFT.appearance, species },
    },
    privacy: { proposeMemories: false, visible: true, muted: false },
  });
}

export default function LandingPalEntry({
  onTarget,
}: {
  onTarget: (target: "pal_talk" | "pal_text") => void;
}) {
  const [species, setSpecies] = useState<LaunchPalSpecies>("robin");
  const [ready, setReady] = useState(false);
  const name = PAL_LAUNCH_COPY[species].title;
  const appearance = {
    ...DEFAULT_PAL_DRAFT.appearance,
    species: species as PubPalSpecies,
  };

  const begin = (mode: PalGuestInputMode) => {
    prepareGuestPal(species, mode);
    onTarget(mode === "talk" ? "pal_talk" : "pal_text");
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="lpPalEntry" aria-labelledby="landing-pal-title" data-ready={ready ? "true" : "false"}>
      <div className="lpPalEntryStage">
        <div className="lpPalEntryPortrait">
          <PalPortrait appearance={appearance} name={name} compact />
        </div>
        <div className="lpPalEntryIdentity">
          <h2 id="landing-pal-title">Choose your Pub Pal</h2>
          <strong aria-live="polite">{name}</strong>
          <span>5 guest prompts</span>
        </div>
      </div>

      <div className="lpPalChoices" aria-label="Pub Pal forms">
        {PAL_ONBOARDING_SPECIES.map((candidate) => (
          <button
            className="lpPalChoice"
            type="button"
            aria-pressed={species === candidate}
            key={candidate}
            onClick={() => setSpecies(candidate)}
          >
            {PAL_LAUNCH_COPY[candidate].title}
          </button>
        ))}
      </div>

      <div className="lpPalEntryModes">
        <Link
          prefetch={false}
          className="lpButton lpButtonPrimary lpPalModeTalk"
          href={palGuestChatHref(species, "talk")}
          onClick={() => begin("talk")}
        >
          <Mic size={18} aria-hidden="true" /> Talk
        </Link>
        <Link
          prefetch={false}
          className="lpButton lpPalModeText"
          href={palGuestChatHref(species, "text")}
          onClick={() => begin("text")}
        >
          <MessageCircle size={18} aria-hidden="true" /> Text
        </Link>
      </div>
    </section>
  );
}
