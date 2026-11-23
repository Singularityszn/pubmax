"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import Screen from "@/components/ui/screen";
import WantedCapture from "@/components/wanted/WantedCapture";
import {
  clearSharedPaste,
  readSharedPaste,
  SHARE_TARGET_PATH,
  SHARE_TARGET_SIGN_IN_HREF,
  stashSharedPaste,
} from "@/lib/nativeShareTarget";
import { safeLocalStorage } from "@/lib/safeStorage";

type Props = {
  /** What the server built from this request's `title`, `text` and `url`. */
  sharedPaste: string;
};

export default function ShareToWanted({ sharedPaste }: Props) {
  const session = useViewerSession();
  // The kept paste is read after mount: localStorage is not there on the
  // server, and a first paint that differed from the server's would not
  // hydrate.
  const [keptPaste, setKeptPaste] = useState("");
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const storage = safeLocalStorage();
    if (sharedPaste) {
      // Kept on this device, so a sign-in round trip does not lose it, and
      // taken out of the address bar, so it is not in history or a referrer.
      stashSharedPaste(storage, sharedPaste);
      try {
        window.history.replaceState(window.history.state, "", SHARE_TARGET_PATH);
      } catch {
        // A blocked history write leaves the query in place, which is harmless.
      }
      return;
    }
    const kept = readSharedPaste(storage);
    if (kept) void Promise.resolve().then(() => setKeptPaste(kept));
  }, [sharedPaste]);

  const paste = dismissed ? "" : sharedPaste || keptPaste;

  function forget() {
    clearSharedPaste(safeLocalStorage());
    setDismissed(true);
  }

  const signedOutDoor = !saved && !session.unresolved && session.signedOut;
  const capturing = !saved && !session.unresolved && !session.signedOut;

  return (
    <Screen
      as="main"
      id="main"
      className="sharePage"
      title="Save a pub to try"
      titleId="share-heading"
      lede={
        signedOutDoor
          ? "Sign in to keep a list of pubs to try. What you shared stays on this phone until you do."
          : capturing
            ? paste
              ? "Check the name, then press Find. We never open the link itself."
              : "Nothing came through with that share. Type a pub name or paste a link."
            : undefined
      }
      answer={
        signedOutDoor && paste ? (
          <p className="sharePage__shared">
            You shared: <span>{paste}</span>
          </p>
        ) : undefined
      }
      primary={
        saved ? (
          <Link href="/u/you#wanted">See your pubs to try</Link>
        ) : signedOutDoor ? (
          <Link href={SHARE_TARGET_SIGN_IN_HREF}>Sign in</Link>
        ) : undefined
      }
      secondary={
        signedOutDoor && paste ? (
          <button type="button" onClick={forget}>
            Forget it
          </button>
        ) : undefined
      }
    >
      {saved ? (
        <p role="status" className="sharePage__status">Done.</p>
      ) : session.unresolved ? (
        <p role="status" className="sharePage__status">Checking your account…</p>
      ) : capturing ? (
        <WantedCapture
          key={paste}
          initialPaste={paste}
          onSaved={() => {
            clearSharedPaste(safeLocalStorage());
            setSaved(true);
          }}
        />
      ) : null}
    </Screen>
  );
}
