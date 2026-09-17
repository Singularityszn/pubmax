import Link from "next/link";
import { ArrowRight, Camera, Coffee, Landmark, Leaf, Moon, Store, Waves } from "lucide-react";

import IntentLink from "@/components/nav/IntentLink";

import styles from "./Tonight.module.css";

import {
  CULTURE_CRAWL_CHIPS,
  CULTURE_CRAWL_MISSION,
  type CultureCrawlChipId,
} from "@/lib/cultureCrawl";
import {
  planOccasionHref,
  TONIGHT_SOFT_PLAN_CHIPS,
  type SoftPlanOccasionId,
} from "@/lib/planOccasion";

const CHIP_ICONS: Record<Exclude<SoftPlanOccasionId, "quiet">, typeof Coffee> = {
  coffee: Coffee,
  af: Leaf,
  chill: Moon,
};

const CULTURE_ICONS: Record<CultureCrawlChipId, typeof Coffee> = {
  "gallery-pint": Landmark,
  "market-kebab": Store,
  "river-historic": Waves,
  "sights-quiet": Camera,
};

type Props = {
  /** Heritage quiet-pint module is on the page below — link scrolls to it. */
  hasQuietPint?: boolean;
};

/**
 * Compact soft-plan handoff on /tonight during a quiet typical-pattern hour.
 * Plan links only; no invented listings.
 */
export default function TonightSoftPlansModule({ hasQuietPint = false }: Props) {
  return (
    <section
      className={styles.tonightSoftPlans}
      aria-label="Soft plans tonight"
      data-testid="tonight-soft-plans"
    >
      {/* Each row's way-onward arrow sits in the lane the compose action floats
          in on a phone, so the row takes that lane (createFab.css). */}
      <p className={styles.tonightSoftPlansEyebrow}>Soft plans tonight</p>
      <ul className={styles.tonightSoftPlansList}>
        {TONIGHT_SOFT_PLAN_CHIPS.map((chip) => {
          const Icon = CHIP_ICONS[chip.id];
          return (
            <li key={chip.id} className={styles.tonightSoftPlansRow}>
              <IntentLink
                href={planOccasionHref(chip.id, { src: "tonight-soft" })}
                className={`${styles.tonightSoftPlansLink} createFabLane pressable`}
              >
                <span className={styles.tonightSoftPlansIcon} aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className={styles.tonightSoftPlansLabel}>{chip.label}</span>
                <ArrowRight size={15} aria-hidden="true" className={styles.tonightSoftPlansArrow} />
              </IntentLink>
            </li>
          );
        })}
        {hasQuietPint ? (
          <li className={styles.tonightSoftPlansRow}>
            <Link href="#tonight-quiet-pint" className={`${styles.tonightSoftPlansLink} createFabLane pressable`}>
              <span className={styles.tonightSoftPlansIcon} aria-hidden="true">
                <Moon size={17} />
              </span>
              <span className={styles.tonightSoftPlansLabel}>A quiet pint</span>
              <ArrowRight size={15} aria-hidden="true" className={styles.tonightSoftPlansArrow} />
            </Link>
          </li>
        ) : null}
      </ul>
      <p className={`${styles.tonightSoftPlansEyebrow} ${styles.tonightSoftPlansCultureEyebrow}`}>
        {CULTURE_CRAWL_MISSION}
      </p>
      <ul className={styles.tonightSoftPlansList}>
        {CULTURE_CRAWL_CHIPS.map((chip) => {
          const Icon = CULTURE_ICONS[chip.id];
          return (
            <li key={chip.id} className={styles.tonightSoftPlansRow}>
              <IntentLink
                href={planOccasionHref(chip.id, { src: "tonight-culture" })}
                className={`${styles.tonightSoftPlansLink} createFabLane pressable`}
              >
                <span className={styles.tonightSoftPlansIcon} aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className={styles.tonightSoftPlansLabel}>{chip.label}</span>
                <ArrowRight size={15} aria-hidden="true" className={styles.tonightSoftPlansArrow} />
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
