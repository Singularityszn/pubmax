import { Bot, Cat, Rabbit, Squirrel, Turtle, type LucideIcon } from "lucide-react";
import type { PubPalAppearance } from "@/lib/pubPal";

const legacySpeciesIcons: Partial<Record<PubPalAppearance["species"], LucideIcon>> = {
  cat: Cat,
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  bot: Bot,
};

const CHARACTER_SPECIES = ["hound", "raven", "fox"] as const;

function isCharacterSpecies(
  species: PubPalAppearance["species"],
): species is (typeof CHARACTER_SPECIES)[number] {
  return CHARACTER_SPECIES.includes(species as (typeof CHARACTER_SPECIES)[number]);
}

function CharacterFace({ species }: { species: (typeof CHARACTER_SPECIES)[number] }) {
  return (
    <span className={`palCharacter palCharacter-${species}`} data-pal-species={species}>
      <span className="palCharacterEar palCharacterEarLeft" />
      <span className="palCharacterEar palCharacterEarRight" />
      <span className="palCharacterHead">
        <span className="palCharacterBrow palCharacterBrowLeft" />
        <span className="palCharacterBrow palCharacterBrowRight" />
        <span className="palCharacterEye palCharacterEyeLeft"><span className="palCharacterPupil" /></span>
        <span className="palCharacterEye palCharacterEyeRight"><span className="palCharacterPupil" /></span>
        <span className="palCharacterBeak" />
        <span className="palCharacterMuzzle"><span className="palCharacterMouth" /></span>
        <span className="palCharacterCheek palCharacterCheekLeft" />
        <span className="palCharacterCheek palCharacterCheekRight" />
      </span>
      <span className="palCharacterNeck" />
    </span>
  );
}

const speciesDescriptions: Record<PubPalAppearance["species"], string> = {
  hound: "an alert cyber hound with an open, loyal expression",
  raven: "an observant holographic raven with a calm profile",
  fox: "a quick cyber fox with bright, curious eyes",
  cat: "a composed signal cat with a quietly mischievous expression",
  rabbit: "an alert neon rabbit ready for an unexpected side quest",
  turtle: "a steady chrome turtle who never rushes a good night",
  squirrel: "a bright holographic squirrel collecting stories instead of acorns",
  bot: "a pocket-sized night bot with an expressive screen face",
};

export default function PalPortrait({
  appearance,
  name,
  compact = false,
}: {
  appearance: PubPalAppearance;
  name: string;
  compact?: boolean;
}) {
  const LegacyIcon = legacySpeciesIcons[appearance.species];

  return (
    <div
      className={`palPortrait palPortrait-${appearance.signalAffinity} palPortrait-${appearance.material} ${compact ? "isCompact" : ""}`}
      role="img"
      aria-label={`${name}, ${speciesDescriptions[appearance.species]}. ${appearance.material} material with ${appearance.signalAffinity} affinity.`}
    >
      <span className="palPortraitField" aria-hidden="true" />
      <span className="palPortraitOrbit palPortraitOrbitA" aria-hidden="true" />
      <span className="palPortraitOrbit palPortraitOrbitB" aria-hidden="true" />
      <span className="palPortraitCore" aria-hidden="true">
        {isCharacterSpecies(appearance.species) ? (
          <CharacterFace species={appearance.species} />
        ) : LegacyIcon ? (
          <LegacyIcon className="palLegacyIcon" strokeWidth={1.15} />
        ) : null}
        <span className="palPortraitScan" />
      </span>
      <span className="palPortraitEcho" aria-hidden="true">
        <span className="palPortraitSignalMark" />
      </span>
      {appearance.accessory !== "none" && (
        <span className="palPortraitAccessory" aria-hidden="true">
          {appearance.accessory.replace("-", " ")}
        </span>
      )}
    </div>
  );
}
