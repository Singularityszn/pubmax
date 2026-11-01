import { palQuestStampDate, type PalQuestStamp } from "@/lib/palQuest";

import PalPrint from "./PalPrint";

/** A small, steady tilt from the day, so a book of stamps looks hand-pressed and never shuffles. */
function stampTilt(day: string): number {
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 13) - 6;
}

// One stamp of the Pal's price quest: the Pal's own print in a ring, the pub
// and the day. It is a mark of a price checked, never a score, so it carries
// no number. `fresh` is the stamp landing for the first time.
export default function PalQuestStamp({
  stamp,
  print,
  fresh = false,
}: {
  stamp: PalQuestStamp;
  print: readonly boolean[];
  fresh?: boolean;
}) {
  const date = palQuestStampDate(stamp.day);
  return (
    <figure
      className="palStamp"
      data-fresh={fresh ? "true" : undefined}
      style={{ "--stamp-tilt": `${stampTilt(stamp.day)}deg` } as React.CSSProperties}
    >
      <span className="palStampRing" aria-hidden="true">
        <PalPrint print={print} />
      </span>
      <figcaption className="palStampCaption">
        <span className="palStampPub">{stamp.venueName}</span>
        <span className="palStampDay">{date}</span>
      </figcaption>
    </figure>
  );
}
