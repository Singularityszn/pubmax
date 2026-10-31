"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * "Why this pub": a real button over the pub's reason and credit.
 *
 * A native <summary> has no button role, so a screen reader and a role query
 * could not find the toggle (live walk F20, 30 Oct 2026). The button carries
 * aria-expanded and names the panel it opens. The panel stays in the document
 * while folded, so the reason is still in the server markup, and `hidden`
 * keeps the lazy photograph from loading until the fold opens.
 */
export default function TonightHypedReasonFold({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="tonightHypedReason" data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="tonightHypedReasonToggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={14} aria-hidden="true" className="tonightHypedMoreChevron" />
        Why this pub
      </button>
      <div id={panelId} className="tonightHypedReasonPanel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
