import { Bot, Cat, Rabbit, Squirrel, Turtle, type LucideIcon } from "lucide-react";

import {
  PAL_ONBOARDING_SPECIES,
  type PalAnimationState,
  type PubPalAppearance,
} from "@/lib/pubPal";

const legacySpeciesIcons: Partial<Record<PubPalAppearance["species"], LucideIcon>> = {
  cat: Cat,
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  bot: Bot,
};

type LaunchSpecies = (typeof PAL_ONBOARDING_SPECIES)[number];

function isLaunchSpecies(species: PubPalAppearance["species"]): species is LaunchSpecies {
  return PAL_ONBOARDING_SPECIES.includes(species as LaunchSpecies);
}

function HoundRig() {
  return (
    <svg className="palRig palRigHound" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="160" cy="274" rx="79" ry="18" /></g>
      <g className="palRigBack">
        <path d="M95 86C58 70 45 92 63 148l35-20Z" />
        <path d="M225 86c37-16 50 6 32 62l-35-20Z" />
      </g>
      <g className="palRigBody"><path d="M101 229c12-35 106-35 118 0l18 49H83Z" /></g>
      <g className="palRigHead">
        <path d="M88 118c7-57 137-64 145 3 9 76-28 119-72 119-45 0-83-45-73-122Z" />
        <path className="palRigHighlight" d="M111 116c19-34 80-42 103-5-22-14-64-12-103 5Z" />
      </g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M111 147c12-10 27-9 36 3-12 12-25 13-36-3Z" />
        <path className="palRigEye palRigEyeRight" d="M175 150c9-12 25-13 36-3-10 16-24 15-36 3Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="149" r="5" />
        <circle className="palRigPupil palRigPupilRight" cx="191" cy="149" r="5" />
        <path className="palRigMuzzle" d="M122 170c17-16 63-16 79 1 11 26-7 50-39 50-33 0-51-24-40-51Z" />
        <path className="palRigNose" d="M148 174c7-7 22-7 29 0-3 13-25 13-29 0Z" />
        <path className="palRigMouth" d="M144 198q18 13 36 0" />
      </g>
      <g className="palRigProp palRigCollar">
        <path d="M107 228q54 22 108 0l-4 22q-50 20-100 0Z" />
        <circle cx="161" cy="247" r="12" />
        <path d="M155 247h12M161 241v12" />
      </g>
    </svg>
  );
}

function RavenRig() {
  return (
    <svg className="palRig palRigRaven" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="162" cy="276" rx="72" ry="16" /></g>
      <g className="palRigBody"><path d="M100 261c4-71 32-119 76-119 49 0 70 54 58 121-35 20-96 20-134-2Z" /></g>
      <g className="palRigBack"><path d="M111 193c-38 24-44 63-21 80 30-15 54-44 63-77Z" /></g>
      <g className="palRigHead">
        <path d="M102 109c16-53 107-59 132-6 10 22 2 54-22 72-34 26-103 11-110-66Z" />
        <path className="palRigBeak" d="M194 127 286 157l-91 23c14-18 14-36-1-53Z" />
        <path className="palRigHighlight" d="M126 103c28-27 72-28 93 7-34-16-65-12-93-7Z" />
      </g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M141 132c14-13 32-10 40 4-12 15-30 14-40-4Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="165" cy="134" r="6" />
      </g>
      <g className="palRigProp palRigLens">
        <circle cx="164" cy="135" r="27" />
        <path d="m184 154 24 23M137 111l-16-17" />
      </g>
    </svg>
  );
}

function FoxRig() {
  return (
    <svg className="palRig palRigFox" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="158" cy="276" rx="82" ry="17" /></g>
      <g className="palRigBack">
        <path d="M91 112 104 35l52 58Z" />
        <path d="m229 112-13-77-52 58Z" />
        <path className="palRigTail" d="M209 226c81-31 82 49 20 49-23 0-35-14-31-27 18 12 40 0 11-22Z" />
      </g>
      <g className="palRigBody"><path d="M98 268c4-53 25-78 63-78 41 0 62 27 63 78Z" /></g>
      <g className="palRigHead">
        <path d="M87 112c17-47 126-55 147 1 16 44-15 126-73 126-59 0-91-83-74-127Z" />
        <path className="palRigHighlight" d="M108 104c35-28 77-30 108 2-32-13-69-11-108-2Z" />
        <path className="palRigMuzzle" d="m112 163 49 67 50-67c-33 18-66 18-99 0Z" />
      </g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M105 143c17-12 33-9 43 6-15 8-30 7-43-6Z" />
        <path className="palRigEye palRigEyeRight" d="M174 149c10-15 27-18 43-6-13 13-28 14-43 6Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="146" r="5" />
        <circle className="palRigPupil palRigPupilRight" cx="190" cy="146" r="5" />
        <path className="palRigNose" d="M148 185c7-8 22-8 29 0-5 13-24 13-29 0Z" />
        <path className="palRigMouth" d="M146 204q16 12 32 0" />
      </g>
      <g className="palRigProp palRigCompass">
        <circle cx="161" cy="247" r="22" />
        <path d="m169 235-5 15-13 8 5-16Z" />
      </g>
    </svg>
  );
}

const speciesDescriptions: Record<PubPalAppearance["species"], string> = {
  hound: "an alert signal hound with a loyal expression and collar beacon",
  raven: "an observant signal raven with a long profile and lore lens",
  fox: "a quick signal fox with bright eyes and route compass",
  cat: "a composed signal cat with a quietly mischievous expression",
  rabbit: "an alert neon rabbit ready for an unexpected side quest",
  turtle: "a steady chrome turtle who never rushes a good night",
  squirrel: "a bright holographic squirrel collecting stories instead of acorns",
  bot: "a pocket-sized Night Bot with an expressive screen face",
};

export default function PalPortrait({ appearance, name, compact = false, state = "idle" }: {
  appearance: PubPalAppearance;
  name: string;
  compact?: boolean;
  state?: PalAnimationState;
}) {
  const LegacyIcon = legacySpeciesIcons[appearance.species];
  const Rig = appearance.species === "hound" ? HoundRig : appearance.species === "raven" ? RavenRig : FoxRig;

  return (
    <div
      className={`palPortrait palPortrait-${appearance.signalAffinity} palPortrait-${appearance.material} ${compact ? "isCompact" : ""}`}
      data-pal-state={state}
      role="img"
      aria-label={`${name}, ${speciesDescriptions[appearance.species]}. ${appearance.material} material with ${appearance.signalAffinity} affinity. ${state} state.`}
    >
      <span className="palPortraitField" aria-hidden="true" />
      <span className="palPortraitOrbit palPortraitOrbitA" aria-hidden="true" />
      <span className="palPortraitOrbit palPortraitOrbitB" aria-hidden="true" />
      <span className="palPortraitCore" aria-hidden="true">
        {isLaunchSpecies(appearance.species) ? <Rig /> : LegacyIcon ? <LegacyIcon className="palLegacyIcon" strokeWidth={1.15} /> : null}
        <span className="palPortraitScan" />
      </span>
      <span className="palPortraitEcho" aria-hidden="true"><span className="palPortraitSignalMark" /></span>
      {appearance.accessory !== "none" ? <span className="palPortraitAccessory" aria-hidden="true">{appearance.accessory.replace("-", " ")}</span> : null}
    </div>
  );
}
