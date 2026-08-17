"use client";

import { useState, type FormEvent } from "react";

import { submitAdminToken } from "@/lib/adminSessionClient";

import "./admin.css";

/** The global under a name, because a detached `fetch` is an illegal call. */
const browserFetch = (input: string, init?: RequestInit): Promise<Response> =>
  fetch(input, init);

/**
 * The only surface an anonymous GET /admin may show. It spends the existing
 * session POST, proves the cookie landed, and only then reloads so the document
 * guard can admit the console. A silent reload onto this same form would read
 * as a correct token being ignored.
 */
export default function AdminTokenForm(): React.JSX.Element {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const outcome = await submitAdminToken(token, browserFetch);
    if (outcome.status === "refused") {
      setError(outcome.message);
      setBusy(false);
      return;
    }
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
