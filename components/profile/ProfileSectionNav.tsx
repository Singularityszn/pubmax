"use client";

import { useSyncExternalStore } from "react";

const SECTIONS = [
  { id: "timeline", label: "Moments" },
  { id: "passport", label: "Passport" },
  { id: "wanted", label: "Pubs to try" },
  { id: "saved-pubs", label: "Saved" },
  { id: "account-settings", label: "Settings" },
] as const;

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export default function ProfileSectionNav() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const selected = hash || "#timeline";
  return (
    <nav className="youProfileTabs" aria-label="Your profile sections">
      {SECTIONS.map(({ id, label }) => (
        <a key={id} href={`#${id}`} aria-current={selected === `#${id}` ? "location" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
