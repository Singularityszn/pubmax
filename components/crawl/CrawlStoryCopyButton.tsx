"use client";

import { useState } from "react";

export default function CrawlStoryCopyButton() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copyLink() {
    setError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        navigator.onLine === false
          ? "You look offline. Reconnect, then try again."
          : "Could not copy link. Try again.",
      );
    }
  }

  return (
    <>
      <button type="button" className="storySecondaryBtn" onClick={copyLink}>
        {copied ? "Copied" : "Copy link"}
      </button>
      {error ? <p role="status">{error}</p> : null}
    </>
  );
}
