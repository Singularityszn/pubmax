import Link from "next/link";

import styles from "@/app/out/Out.module.css";
import type { OutOpenPlan } from "@/lib/out";
import { crewPath } from "@/lib/socialCrewsUi";

function formatPlanWhen(startTime: string): string {
  if (!Number.isFinite(Date.parse(startTime))) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(startTime));
}

type OutOpenPlanCardProps = {
  plan: OutOpenPlan;
};

export function OutOpenPlanCard({ plan }: OutOpenPlanCardProps) {
  const when = formatPlanWhen(plan.startTime);
  const meet = plan.meetingPoint?.name ?? plan.stopVenueName ?? "Meeting point";
  return (
    <li className={styles.outOpenPlanCard}>
      <Link className={`${styles.outOpenPlanLink} pressable`} href={crewPath(plan.crewId)}>
        <h3 className={styles.outOpenPlanTitle}>{plan.title}</h3>
        <p className={styles.outOpenPlanMeta}>
          @{plan.hostHandle}
          {when ? ` · ${when}` : ""}
        </p>
        <p className={styles.outOpenPlanMeet}>Meet at {meet}</p>
      </Link>
    </li>
  );
}
