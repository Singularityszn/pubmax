"use client";

// "We're out" check-in composer (Social Loop v1). A deliberately tiny surface:
// pick an AREA (never a coordinate), optionally add a line, post. Visible to your
// lot (mutual follows) only — the copy says so plainly. Auto-expires after 12h.
// No email/password: the author is the viewer's own handle (useViewerHandle, the
// one owner of that rule). A signed-out viewer meets a sign-in door in place of
// the form, and an account with no handle yet meets a door to claim one, so the
// form never opens only to refuse on submit.

import Link from "next/link";
import { useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SiteNav from "@/components/nav/SiteNav";
import { trackEvent } from "@/lib/analytics";
import { getNightAreasForCity } from "@/lib/nightAreas";
import "../feed/feed.css";
import "./we-are-out.css";
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
  const viewerSession = useViewerSession();
  const handle = useViewerHandle() ?? "";
  // An account's handle is unknown until its identity resolves, which is not the
  // same as having none: the claim door waits for the answer.
  const { identityResolved } = useAuth();
  const [areaSlug, setAreaSlug] = useState<string>("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<PostState>("idle");
  const [error, setError] = useState("");

  if (!socialFriendsLaunchEnabled) {
    return (
      <main id="main" className="feedShell weAreOut">
        <SiteNav active="feed" />
        <section className="weAreOutDone" role="status">
          <p className="weAreOutDoneTitle">{socialBoundaryCopy("preview", false)}</p>
          <Link className="feedDropCta" href="/u/you#night-memories">
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
    <main id="main" className="feedShell weAreOut">
      <SiteNav active="feed" />

      <div className="weAreOutLayout">
        <header className="feedHeader">
          <p className="feedEyebrow">Tonight</p>
          <h1 className="feedTitle">I&rsquo;m here</h1>
          <p className="feedLede">
            Tell your lot you&rsquo;re here tonight. Area only, no exact spot. Friends
            who follow you back see it. It clears itself after 12 hours.
          </p>
        </header>

        {state === "done" ? (
          <section className="weAreOutDone" role="status">
            <p className="weAreOutDoneTitle">You&rsquo;re here. Your lot can see it.</p>
            <div className="weAreOutDoneActions">
              {socialFriendsLaunchEnabled ? (
                <Link className="feedDropCta" href="/social">
                  Open Social
                </Link>
              ) : (
                <Link className="feedDropCta" href="/u/you#night-memories">
                  Open Memories
                </Link>
              )}
            </div>
          </section>
        ) : viewerSession.signedOut ? (
          <section className="weAreOutForm weAreOutDoor" aria-labelledby="we-are-out-door-title">
            <p id="we-are-out-door-title" className="weAreOutDoneTitle">
              Sign in to tell your lot.
            </p>
            <p className="weAreOutPrivacy">
              A check-in goes to friends who follow you back, so it needs your
              account. Area only, never your exact spot.
            </p>
            <Link className="weAreOutSubmit weAreOutDoorAction" href="/login?from=%2Fwe-are-out">
              Sign in
            </Link>
          </section>
        ) : viewerSession.signedIn && identityResolved && !handle ? (
          <section className="weAreOutForm weAreOutDoor" aria-labelledby="we-are-out-door-title">
            <p id="we-are-out-door-title" className="weAreOutDoneTitle">
              Choose a handle first.
            </p>
            <p className="weAreOutPrivacy">
              Your lot sees a check-in under your handle. Pick one, then come back.
            </p>
            <Link className="weAreOutSubmit weAreOutDoorAction" href="/u/you">
              Choose a handle
            </Link>
          </section>
        ) : (
          <section className="weAreOutForm">
            <label className="weAreOutField">
              <span className="weAreOutLabel">Area</span>
              <select
                className="weAreOutSelect"
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

            <label className="weAreOutField">
              <span className="weAreOutLabel">
                A line <span className="weAreOutOptional">(optional)</span>
              </span>
              <input
                className="weAreOutInput"
                type="text"
                maxLength={140}
                value={note}
                placeholder="Garden's rammed, come find us"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <p className="weAreOutPrivacy">
              Visible to your lot only. Never your exact location.
            </p>

            {state === "error" && error ? (
              <p className="weAreOutError" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              className="weAreOutSubmit"
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
