"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  browserFetch,
  clearLegacyAdminTokenStorage,
  submitAdminToken,
} from "@/lib/adminSessionClient";
import styles from "./Admin.module.css";

type AdminSessionEntryProps = {
  onOpened: () => void | Promise<void>;
  submitLabel?: string;
};

/** One ephemeral token boundary shared by both moderator entry points. */
export default function AdminSessionEntry({
  onOpened,
  submitLabel = "Open console",
}: AdminSessionEntryProps): React.JSX.Element {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clearLegacyAdminTokenStorage();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const submittedToken = token;
    setToken("");
    setBusy(true);
    setError(null);
    const outcome = await submitAdminToken(submittedToken, browserFetch);
    if (outcome.status === "refused") {
      setError(outcome.message);
      setBusy(false);
      return;
    }
    await onOpened();
    setBusy(false);
  }

  return (
    <>
      <form className={styles.adminBar} onSubmit={(event) => void onSubmit(event)}>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Admin token"
          aria-label="Admin token"
          autoComplete="current-password"
          required
        />
        <button className={styles.adminBtn} type="submit" disabled={busy}>
          {busy ? "Checking…" : submitLabel}
        </button>
      </form>
      {error ? (
        <p className={styles.adminMsg} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
