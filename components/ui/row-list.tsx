import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./primitives.css";

/**
 * A list of things, read down the page: one hairline between rows and no box
 * around them (taste plan, 18 Oct 2026; DESIGN_SYSTEM.md "Edges").
 *
 * This is the shape a stack of identical bordered cards should have been. A
 * card says "this one is raised above the rest"; a list of twelve pubs has no
 * one raised above the rest, so it gets rows. The /crawls compact list was the
 * first surface built this way and this primitive is that shape, shared.
 */
export function RowList({
  label,
  children,
  className,
}: {
  /** The list's accessible name when no visible heading names it. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul className={["rowList", className].filter(Boolean).join(" ")} aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * One row: an optional lead (a number, a face, a small photo), a title with an
 * optional meta line under it, an optional block of detail under that, and an
 * optional trailing figure (a price badge, a count). When `href` is given the
 * whole row is one tap target through the title's link, so the target is never
 * a 20px line of text. A link inside `detail` (a price's source, say) stays its
 * own tap target above the row's.
 */
export function RowListItem({
  href,
  lead,
  title,
  meta,
  detail,
  trailing,
  className,
  prefetch = false,
}: {
  href?: Route;
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Block content under the meta line, such as a paragraph of price evidence. */
  detail?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  prefetch?: boolean;
}) {
  return (
    <li className={["rowListItem", href ? "rowListItem--link" : null, className].filter(Boolean).join(" ")}>
      {lead ? <span className="rowListLead">{lead}</span> : null}
      <div className="rowListBody">
        {href ? (
          <Link prefetch={prefetch} href={href} className="rowListTitle rowListTitleLink">
            {title}
          </Link>
        ) : (
          <span className="rowListTitle">{title}</span>
        )}
        {meta ? <span className="rowListMeta">{meta}</span> : null}
        {detail ? <div className="rowListDetail">{detail}</div> : null}
      </div>
      {trailing ? <span className="rowListTrailing">{trailing}</span> : null}
    </li>
  );
}
