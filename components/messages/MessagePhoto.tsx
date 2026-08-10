"use client";

// A photo somebody sent you, in the thread.
//
// WHY THIS IS NOT AN `<img src>` POINTED AT THE ROUTE. A DM photo is the one
// owned image in this tree that is NOT public: the bytes are gated by the same
// courtesy participant check the thread read makes, and that check reads a
// bearer token an `<img>` cannot send. So the bytes come through `authedFetch`
// like every other gated read on this surface, and the tile renders the object
// URL. ONE gate, and no short-lived signed URL minted that would outlive the
// check that authorised it.
//
// The tile is capped by HEIGHT rather than width, because a thread is read by
// scrolling and a portrait photograph filling the line would push the words
// after it a screen away. Tap opens the full frame in a dialog, so the thread
// is still behind it and Escape is the way out on every platform.

import { useCallback, useEffect, useRef, useState } from "react";

import { authedFetch } from "@/lib/authedFetch";
import {
  MESSAGE_PHOTO_UNREADABLE_LINE,
  messagePhotoAltText,
} from "@/lib/messageAttachments";
import { discardBody } from "@/lib/responseBody";

type MessagePhotoProps = {
  url: string;
  width: number;
  height: number;
  senderHandle: string;
  handle: string;
};

export default function MessagePhoto({
  url,
  width,
  height,
  senderHandle,
  handle,
}: MessagePhotoProps): React.JSX.Element {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    const controller = new AbortController();
    const address = handle ? `${url}?handle=${encodeURIComponent(handle)}` : url;

    void (async () => {
      try {
        const res = await authedFetch(address, { signal: controller.signal });
        if (!res.ok) {
          // Between learning the status and reading the body, let the body go.
          discardBody(res);
          if (active) setFailed(true);
          return;
        }
        const blob = await res.blob();
        if (!active) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, handle]);

  // `showModal` rather than the `open` attribute: only a modal dialog gets the
  // backdrop, the focus trap and Escape for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  if (failed) {
    return <p className="messagePhotoFailed">{MESSAGE_PHOTO_UNREADABLE_LINE}</p>;
  }
  if (!objectUrl) {
    // The box is reserved at the photo's own aspect, so the thread does not
    // jump under a reader's thumb when the bytes land.
    return (
      <p className="messagePhotoPending" style={{ aspectRatio: `${width} / ${height}` }}>
        Loading photo
      </p>
    );
  }

  const alt = messagePhotoAltText(senderHandle);

  return (
    <figure className="messagePhotoFigure">
      <button type="button" className="messagePhotoButton" onClick={() => setOpen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- gated bytes read as an object URL; no loader can fetch them */}
        <img
          className="messagePhoto"
          src={objectUrl}
          width={width}
          height={height}
          alt={alt}
          decoding="async"
        />
      </button>
      <dialog ref={dialogRef} className="messagePhotoViewer" onClose={close}>
        {/* eslint-disable-next-line @next/next/no-img-element -- same object URL, full frame */}
        <img className="messagePhotoViewerImage" src={objectUrl} alt={alt} />
        <button type="button" className="messagePhotoViewerClose" onClick={close}>
          Close
        </button>
      </dialog>
    </figure>
  );
}
