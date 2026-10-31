import { useState, type ReactNode } from "react";

import { overviewFold, type OverviewFoldKey } from "@/lib/venueOverviewFolds";

/**
 * One of the Overview's five folds (lib/venueOverviewFolds.ts). The label, the
 * hint and whether it opens on first render come from the table, never from a
 * caller, so the order and the words have one home.
 *
 * The body stays mounted while the fold is shut, exactly as the old "Details
 * and practical info" disclosure kept its rows mounted: a block's own read and
 * its effects run as they did before the regroup. A fold with nothing to show
 * renders nothing, summary included. `present` is the caller's answer for what
 * it knows at render; a body whose every block answered empty later is hidden
 * by `venueSheet.css` (`:has`), so a shut fold never names an empty room.
 *
 * `openOnMount` is a caller asking for this fold by name (the route end's
 * "check the last train" door). The caller keys the fold by that request, so
 * each new ask mounts it open and a reader can still shut it afterwards.
 */
export default function OverviewFold({
  foldKey,
  present = true,
  openOnMount = false,
  children,
}: {
  foldKey: OverviewFoldKey;
  present?: boolean;
  openOnMount?: boolean;
  children: ReactNode;
}) {
  const fold = overviewFold(foldKey);
  const [open, setOpen] = useState(fold.defaultOpen || openOnMount);
  if (!present) return null;
  return (
    <details
      id={`venueFold-${fold.key}`}
      className="venueOverviewFold"
      data-overview-fold={fold.key}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="venueOverviewFoldSummary">
        <span className="venueOverviewFoldLabel">{fold.label}</span>
        <span className="venueOverviewFoldHint">{fold.hint}</span>
      </summary>
      <div className="venueOverviewFoldBody">{children}</div>
    </details>
  );
}
