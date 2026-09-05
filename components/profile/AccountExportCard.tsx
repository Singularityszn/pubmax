"use client";

// Download your own data, beside the account-deletion door.
//
// ONE quiet control in the deletion card's idiom, because the two are the
// same kind of thing: a promise the store makes to the person who owns the
// account. The words come from `lib/accountExport.ts`, which the route reads
// too, so the card cannot describe a file the route does not send.
//
// Identity is TRI-STATE like every surface that names the viewer: nothing is
// offered until the live session answers, and nothing for a stranger. The
// request carries the caller's own bearer (`authedActionFetch`), the route
// derives the account from it, and the answer is handed to the browser as a
// file from a blob URL, the same way the Pal memory export lands.

import { useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import {
  ACCOUNT_EXPORT_BUSY_LINE,
  ACCOUNT_EXPORT_DONE_LINE,
  ACCOUNT_EXPORT_FAILED_LINE,
  ACCOUNT_EXPORT_LABEL,
  ACCOUNT_EXPORT_LEDE,
  ACCOUNT_EXPORT_SESSION_LINE,
  ACCOUNT_EXPORT_TITLE,
  accountExportFilename,
} from "@/lib/accountExport";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { AuthActionSessionError, authedActionFetch } from "@/lib/authedFetch";

/** The file name the server chose, read off its own header, else ours. */
function filenameFrom(response: Response): string {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? accountExportFilename(null, new Date().toISOString());
}

export default function AccountExportCard(): React.JSX.Element | null {
  const { user } = useAuth();
  const viewerSession = useViewerSession();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Latched on a ref before the first await: React commits `busy` in a
  // microtask, so two taps in one task would otherwise both send.
  const inFlight = useRef(false);

  async function download(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(ACCOUNT_EXPORT_BUSY_LINE);
    try {
      const response = await authedActionFetch(
        "/api/account/export",
        { method: "GET" },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setNotice(errorMessageFrom(body, ACCOUNT_EXPORT_FAILED_LINE));
        return;
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filenameFrom(response);
      anchor.click();
      URL.revokeObjectURL(href);
      setNotice(ACCOUNT_EXPORT_DONE_LINE);
    } catch (error) {
      setNotice(
        error instanceof AuthActionSessionError
          ? ACCOUNT_EXPORT_SESSION_LINE
          : ACCOUNT_EXPORT_FAILED_LINE,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // Nothing at all until the live session answers, and nothing for a stranger.
  if (!user || viewerSession.unresolved) return null;

  return (
    <div className="accountHubExport" id="export-account">
      <h3>{ACCOUNT_EXPORT_TITLE}</h3>
      <p>{ACCOUNT_EXPORT_LEDE}</p>
      <button
        type="button"
        className="accountHubExportButton"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void download()}
      >
        {ACCOUNT_EXPORT_LABEL}
      </button>
      {notice ? (
        <p role="status" className="accountHubExportNotice">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
