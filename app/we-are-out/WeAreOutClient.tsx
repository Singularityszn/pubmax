"use client";

// "We're out" check-in composer (Social Loop v1). A deliberately tiny surface:
// pick an AREA (never a coordinate), optionally add a line, post. Visible to your
// lot (mutual follows) only — the copy says so plainly. Auto-expires after 12h.
// No email/password: the author is the localStorage handle (same identity that
// drops a pint), read after mount so SSR + hydration agree.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { trackEvent } from "@/lib/analytics";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import feedStyles from "../feed/Feed.module.css";
import styles from "./WeAreOut.module.css";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { socialBoundaryCopy } from "@/lib/socialLaunch";

type PostState = "idle" | "posting" | "done" | "error";

type Props = {
  /** Server-threaded friends-launch gate — client never reads env. */
  socialFriendsLaunchEnabled?: boolean;
};

export default function WeAreOutClient({ socialFriendsLaunchEnabled = true }: Props) {
  const areas = useMemo(() => getNightAreasForCity("london"), []);
  const [handle, setHandle] = useState("");
  const [areaSlug, setAreaSlug] = useState<string>("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<PostState>("idle");
  const [error, setError] = useState("");

  // Read the viewer's handle after mount (the server can't see localStorage).
  // setState fires from a microtask (never the sync effect body) per
  // react-hooks/set-state-in-effect — the house pattern on /feed.
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const stored = normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
        if (stored) setHandle(stored);
      } catch {
        // Storage disabled — the form prompts to claim a handle on submit.
      }
    });
  }, []);

  if (!socialFriendsLaunchEnabled) {
    return (
      <main id="main" className={`${feedStyles.feedShell} ${styles.weAreOut}`}>
        <SiteNav active="feed" />
        <section className={styles.weAreOutDone} role="status">
          <p className={styles.weAreOutDoneTitle}>{socialBoundaryCopy("preview", false)}</p>
          <Link className={feedStyles.feedDropCta} href="/u/you#night-memories">
            Open Memories
          </Link>
        </section>
      </main>
    );
  }

  async function post() {
    if (!handle) {
      setError("Choose a handle in your account first.");
      setState("error");
      return;
    }
    if (!areaSlug) {
      setError("Pick an area.");
      setState("error");
      return;
    }
    setState("posting");
    setError("");
    try {
      const res = await authedActionFetch("/api/check-ins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, areaSlug, note, visibility: "friends" }),
      }, { requiresIdentity: true });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessageFrom(data, "Could not post that."));
      trackEvent("check_in_created");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't send. Give it another go.");
      setState("error");
    }
  }

  return (
    <main id="main" className={`${feedStyles.feedShell} ${styles.weAreOut}`}>
      <SiteNav active="feed" />

      <div className={`${styles.weAreOutLayout} ${styles.weAreOutLayoutDesktop}`}>
        <header className={`${feedStyles.feedHeader} ${styles.feedHeaderInWeAreOut} ${styles.feedHeaderDesktop}`}>
          <p className={`${feedStyles.feedEyebrow} ${styles.feedEyebrowInWeAreOut}`}>Tonight</p>
          <h1 className={`${feedStyles.feedTitle} ${styles.feedTitleInWeAreOut}`}>I&rsquo;m here</h1>
          <p className={`${feedStyles.feedLede} ${styles.feedLedeDesktop}`}>
            Tell your lot you&rsquo;re here tonight. Area only, no exact spot. Friends
            who follow you back see it. It clears itself after 12 hours.
          </p>
        </header>

        {state === "done" ? (
          <section className={`${styles.weAreOutDone} ${styles.weAreOutDoneDesktop}`} role="status">
            <p className={styles.weAreOutDoneTitle}>You&rsquo;re here. Your lot can see it.</p>
            <div className={styles.weAreOutDoneActions}>
              {socialFriendsLaunchEnabled ? (
                <Link className={feedStyles.feedDropCta} href="/social">
                  Open Social
                </Link>
              ) : (
                <Link className={feedStyles.feedDropCta} href="/u/you#night-memories">
                  Open Memories
                </Link>
              )}
            </div>
          </section>
        ) : (
          <section className={`${styles.weAreOutForm} ${styles.weAreOutFormDesktop}`}>
            <label className={styles.weAreOutField}>
              <span className={styles.weAreOutLabel}>Area</span>
              <select
                className={styles.weAreOutSelect}
                value={areaSlug}
                onChange={(e) => setAreaSlug(e.target.value)}
              >
                <option value="">Where are you?</option>
                {areas.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.weAreOutField}>
              <span className={styles.weAreOutLabel}>
                A line <span className={styles.weAreOutOptional}>(optional)</span>
              </span>
              <input
                className={styles.weAreOutInput}
                type="text"
                maxLength={140}
                value={note}
                placeholder="Garden's rammed, come find us"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <p className={styles.weAreOutPrivacy}>
              Visible to your lot only. Never your exact location.
            </p>

            {state === "error" && error ? (
              <p className={styles.weAreOutError} role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              className={styles.weAreOutSubmit}
              disabled={state === "posting"}
              onClick={post}
            >
              {state === "posting" ? "Posting." : "I'm here"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
