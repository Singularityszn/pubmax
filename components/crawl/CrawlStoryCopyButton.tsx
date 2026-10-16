"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useState } from "react";

// Copies the page the reader is on. Shared by the crawl story and the Pint Drop
// permalink (`app/p/[id]`), which each bring their own button class. A client
// component rather than an inline script, because React never runs a script
// it renders on a client-side navigation (review finding PAGE-5).
export default function CrawlStoryCopyButton({
  className = "storySecondaryBtn",
}: {
  className?: string;
}) {
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
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={copyLink}>
        {copied ? "Copied" : "Copy link"}
      </button>
      {error ? <p role="status">{error}</p> : null}
    </>
  );
}
