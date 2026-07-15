import { Bird, Bot, Cat, Dog, Rabbit, Squirrel, Turtle, type LucideIcon } from "lucide-react";
import type { PubPalAppearance } from "@/lib/pubPal";

const speciesIcons: Record<PubPalAppearance["species"], LucideIcon> = {
  hound: Dog,
  raven: Bird,
  fox: Cat,
  cat: Cat,
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  bot: Bot,
};

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
  const Icon = speciesIcons[appearance.species];

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
        <Icon strokeWidth={1.15} />
        <span className="palPortraitScan" />
      </span>
      <span className="palPortraitEcho" aria-hidden="true">
        <Icon strokeWidth={0.8} />
      </span>
      {appearance.accessory !== "none" && (
        <span className="palPortraitAccessory" aria-hidden="true">
          {appearance.accessory.replace("-", " ")}
        </span>
      )}
    </div>
  );
}
