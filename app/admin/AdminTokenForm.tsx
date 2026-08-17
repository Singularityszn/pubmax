"use client";

import { useState, type FormEvent } from "react";

import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";

import "./admin.css";

const UNREACHABLE_MESSAGE = "Could not reach the server. Try again.";

/**
 * The only surface an anonymous GET /admin may show. It spends the existing
 * session POST and reloads so the document guard can admit the console.
 */
export default function AdminTokenForm(): React.JSX.Element {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/admin/session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
    } catch {
      setError(UNREACHABLE_MESSAGE);
      setBusy(false);
      return;
    }
    if (!res.ok) {
      const body = await readApiJson(res).catch(() => null);
      discardBody(res);
      setError(errorMessageFrom(body, "Not authorised."));
      setBusy(false);
      return;
    }
    discardBody(res);
    window.location.assign("/admin");
  }

  return (
    <main className="admin">
      <h1>Moderator sign-in</h1>
      <p className="admin-sub">Enter the admin token to open the console.</p>
      <form className="admin-bar" onSubmit={(event) => void onSubmit(event)}>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Admin token"
          aria-label="Admin token"
          autoComplete="current-password"
        />
        <button className="admin-btn" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Open console"}
        </button>
      </form>
      {error ? (
        <p className="admin-msg" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
