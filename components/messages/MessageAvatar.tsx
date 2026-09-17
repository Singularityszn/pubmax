"use client";

import { useState } from "react";

import { handleMonogram } from "@/lib/messageTimeline";
import styles from "@/app/messages/Messages.module.css";

/**
 * The face beside a handle on a messaging surface.
 *
 * A photograph when the row carries one, and the handle's first letter on the
 * house panel when it does not. The letter is drawn from the handle, never
 * from a display name, because the handle is the thing printed beside it and
 * the two must agree. A photograph that fails to load falls back to the letter
 * rather than to a broken image glyph. The failure is remembered BY URL, so a
 * later, working URL is simply tried: no effect has to reset anything.
 *
 * Decorative: the handle next to it carries the name, so this is aria-hidden.
 */
export default function MessageAvatar({
  handle,
  avatarUrl,
  size = 44,
}: {
  handle: string;
  avatarUrl?: string | null;
  size?: number;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(avatarUrl) && failedUrl !== avatarUrl;
  return (
    <span
      className={styles.messageAvatar}
      style={{ "--message-avatar-size": `${size}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      {showPhoto && avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        handleMonogram(handle)
      )}
    </span>
  );
}
