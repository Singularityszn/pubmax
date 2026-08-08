import Link from "next/link";
import { ArrowUpRight, Coffee, Leaf, Moon } from "lucide-react";

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
      className="tonightSoftPlans"
      aria-label="Soft plans tonight"
      data-testid="tonight-soft-plans"
    >
      <p className="tonightSoftPlansEyebrow">Soft plans tonight</p>
      <ul className="tonightSoftPlansList">
        {TONIGHT_SOFT_PLAN_CHIPS.map((chip) => {
          const Icon = CHIP_ICONS[chip.id];
          return (
            <li key={chip.id} className="tonightSoftPlansRow">
              <Link
                href={planOccasionHref(chip.id, { src: "tonight-soft" })}
                className="tonightSoftPlansLink pressable"
              >
                <span className="tonightSoftPlansIcon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="tonightSoftPlansLabel">{chip.label}</span>
                <ArrowUpRight size={15} aria-hidden="true" className="tonightSoftPlansArrow" />
              </Link>
            </li>
          );
        })}
        {hasQuietPint ? (
          <li className="tonightSoftPlansRow">
            <Link href="#tonight-quiet-pint" className="tonightSoftPlansLink pressable">
              <span className="tonightSoftPlansIcon" aria-hidden="true">
                <Moon size={17} />
              </span>
              <span className="tonightSoftPlansLabel">A quiet pint</span>
              <ArrowUpRight size={15} aria-hidden="true" className="tonightSoftPlansArrow" />
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
