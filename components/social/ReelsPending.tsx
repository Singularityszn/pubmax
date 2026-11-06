"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

/**
 * The reel layer while its viewer downloads, or after that download failed.
 * It opens where the reader asked for the reel, full screen, so the wait and
 * any failure are never drawn at the foot of a long feed. Close and Escape
 * dismiss it and hand focus back to the opener.
 */
export default function ReelsPending({
  children,
  opener,
  onClose,
}: {
  children: ReactNode;
  opener: HTMLElement;
  onClose: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDismissOnEscape(true, onClose, layerRef);

  useEffect(() => {
    closeRef.current?.focus();
    return () => {
      if (opener.isConnected) opener.focus();
    };
  }, [opener]);

  return createPortal(
    <div ref={layerRef} className="reels reels--pending" role="dialog" aria-modal="true" aria-label="Reels">
      <div className="reels__chrome">
        <button ref={closeRef} type="button" className="reels__button" onClick={onClose} aria-label="Close reels">
          <X size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="reels__pendingBody">{children}</div>
    </div>,
    document.body,
  );
}
