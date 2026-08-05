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
import "../feed/feed.css";
import "./we-are-out.css";

type PostState = "idle" | "posting" | "done" | "error";

export default function WeAreOutClient() {
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
      const res = await fetch("/api/check-ins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, areaSlug, note, visibility: "friends" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not post that.");
      trackEvent("check_in_created");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't send. Give it another go.");
      setState("error");
    }
  }

  return (
    <main className="feedShell weAreOut">
      <SiteNav active="feed" />

      <header className="feedHeader">
        <p className="feedEyebrow">Out tonight</p>
        <h1 className="feedTitle">We&rsquo;re out</h1>
        <p className="feedLede">
          Tell your lot you&rsquo;re out tonight. Area only, no exact spot. Friends
          who follow you back see it. It clears itself after 12 hours.
        </p>
      </header>

      {state === "done" ? (
        <section className="weAreOutDone" role="status">
          <p className="weAreOutDoneTitle">You&rsquo;re out. Your lot can see it.</p>
          <div className="weAreOutDoneActions">
            <Link className="feedDropCta" href="/social">
              Open Social
            </Link>
          </div>
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
              <option value="">Where are you out?</option>
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
            {state === "posting" ? "Posting." : "We're out"}
          </button>
        </section>
      )}
    </main>
  );
}
