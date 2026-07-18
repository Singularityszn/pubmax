"use client";

import { useState } from "react";

export default function CrawlStoryCopyButton() {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Clipboard can be denied in hardened browsers; the button remains harmless.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="storySecondaryBtn" onClick={copyLink}>
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
