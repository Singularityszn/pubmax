import Link from "next/link";

import { profilePath } from "@/lib/appLink";
import { normalizeHandle } from "@/lib/handleNormalize";
import { formatWithLine, type PintDropWithSummary } from "@/lib/pintDropWithTags";

type Props = {
  summary: PintDropWithSummary;
  className?: string;
};

/**
 * The "with" line on a Pint Drop. An approved tag prints its handle as a link
 * to that person's profile; a tag nobody has approved yet is a count ("with
 * 1 person") and never a handle. The words come from `formatWithLine`, so the
 * plain-text and the linked forms cannot drift.
 */
export default function PintDropWithLine({ summary, className = "pintDropWithLine" }: Props) {
  const line = formatWithLine(summary);
  if (!line) return null;
  const approved = summary.approved.map(normalizeHandle).filter(Boolean);
  if (approved.length === 0) return <p className={className}>{line}</p>;

  // Split the same line at each approved handle so each one can be a link.
  const pieces: React.ReactNode[] = [];
  let rest = line;
  approved.forEach((handle) => {
    const token = `@${handle}`;
    const at = rest.indexOf(token);
    if (at < 0) return;
    if (at > 0) pieces.push(rest.slice(0, at));
    pieces.push(
      <Link key={handle} href={profilePath(handle)} prefetch={false}>
        {token}
      </Link>,
    );
    rest = rest.slice(at + token.length);
  });
  if (rest) pieces.push(rest);
  return <p className={className}>{pieces}</p>;
}
