import { Bird, Bot, Rabbit, Squirrel, Turtle, type LucideIcon } from "lucide-react";

import {
  type PalAnimationState,
  type PubPalAppearance,
  type PubPalSpecies,
} from "@/lib/pubPal";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { pubPalMascotSlugFor } from "@/lib/pubPalMascot";

import styles from "@/app/pal/Pal.module.css";

/**
 * A stored legacy species with no master of its own draws an icon. `hound` is
 * absent because it stands in for the greyhound's master
 * (`PAL_MASCOT_STAND_INS`), so the question is still asked once, through
 * `pubPalMascotSlugFor`, never by comparing species names here.
 */
const legacySpeciesIcons = {
  raven: Bird,
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  bot: Bot,
} satisfies Partial<Record<PubPalSpecies, LucideIcon>>;

type LegacyIconSpecies = keyof typeof legacySpeciesIcons;

const legacySpeciesDescriptions: Record<LegacyIconSpecies, string> = {
  raven: "an observant signal raven with a long profile and lore lens",
  rabbit: "an alert neon rabbit ready for a detour on the way home",
  turtle: "a steady chrome turtle who never rushes a good night",
  squirrel: "a bright holographic squirrel collecting stories instead of acorns",
  bot: "a pocket-sized Night Bot with an expressive screen face",
};

function legacyIconFor(species: PubPalSpecies): { Icon: LucideIcon; description: string } | null {
  if (!Object.prototype.hasOwnProperty.call(legacySpeciesIcons, species)) return null;
  const key = species as LegacyIconSpecies;
  return { Icon: legacySpeciesIcons[key], description: legacySpeciesDescriptions[key] };
}

/**
 * The box `app/pal/Pal.module.css` really draws the full portrait's mascot in.
 *
 * `.palPortrait` is `min(42rem, 74vw)` and `.palPortraitCore` is 58% of it, so
 * the mascot fills about 403 CSS px on a 1440 desktop; under the 760px
 * breakpoint the portrait narrows to `min(18rem, 72vw)` and the mascot to about
 * 167 px. The `size` prop stays the intrinsic width and height pair, and this
 * is what the browser is told to choose a rendition against - the two used to
 * be one number, which under-stated the desktop box by half.
 */
const PORTRAIT_MASCOT_SIZES =
  "(max-width: 760px) min(10.44rem, 41.76vw), min(24.36rem, 42.92vw)";

export default function PalPortrait({ appearance, name, compact = false, state = "idle", priority = false }: {
  appearance: PubPalAppearance;
  name: string;
  compact?: boolean;
  state?: PalAnimationState;
  /** True where this portrait is the largest thing on the screen it opens. */
  priority?: boolean;
}) {
  const mascotSize = compact ? 96 : 192;
  // A species that ships a master is drawn as that photograph. The legacy
  // icons are the only other lane, so the question is asked once here rather
  // than by comparing species names in three places.
  const rendered = pubPalMascotSlugFor(appearance.species) !== null;
  const legacy = rendered ? null : legacyIconFor(appearance.species);

  return (
    <div
      className={`${styles.palPortrait} ${styles[`palPortrait-${appearance.signalAffinity}`]} ${styles[`palPortrait-${appearance.material}`]}${compact ? " isCompact" : ""}`}
      data-pal-state={state}
      {...(legacy
        ? {
            role: "img" as const,
            "aria-label": `${name}, ${legacy.description}. ${appearance.material} material with ${appearance.signalAffinity} affinity. ${state} state.`,
          }
        : {})}
    >
      <span className={styles.palPortraitField} aria-hidden="true" />
      <span className={styles.palPortraitCore} aria-hidden={!rendered}>
        {rendered ? (
          <PubPalMascot
            species={appearance.species}
            size={mascotSize}
            sizes={compact ? undefined : PORTRAIT_MASCOT_SIZES}
            priority={priority}
            circular={false}
            className={styles.palPortraitMascot}
          />
        ) : legacy ? (
          <legacy.Icon className={styles.palLegacyIcon} strokeWidth={1.15} />
        ) : null}
        <span className={styles.palPortraitScan} />
      </span>
      <span className={styles.palPortraitEcho} aria-hidden="true"><span className={styles.palPortraitSignalMark} /></span>
      {appearance.accessory !== "none" ? <span className={styles.palPortraitAccessory} aria-hidden="true">{appearance.accessory.replace("-", " ")}</span> : null}
    </div>
  );
}
