"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cityPubsOnlyNoteFor, type CityPubsOnlyNote as Note } from "@/lib/cityPubsOnlyNote";

import "./cityPubsOnlyNote.css";

/** The line itself. Pure, so a test can render it without a map. */
export function CityPubsOnlyNoteLine({ note }: { note: Note }) {
  return (
    <p className="cityPubsOnlyNote" role="note">
      <span>{note.text}</span>{" "}
      <Link prefetch={false} href={note.href} className="cityPubsOnlyNoteLink">
        {note.linkLabel}
      </Link>
    </p>
  );
}

function subscribeStage(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function stageSnapshot(): Element | null {
  return document.querySelector(".mapStage");
}

function serverStageSnapshot(): Element | null {
  return null;
}

/**
 * Mounts the line inside the map stage, beside the other ambient banners, so
 * the staging rules in components/map/mapBannerStaging.css and the phone chrome
 * heights reach it. components/PubMap.tsx is edit-locked, so the host shell
 * finds the stage once PubMap has drawn it and portals the line in. Nothing
 * renders on the server or for a city with listed prices.
 */
export default function CityPubsOnlyNoteMount({ cityId }: { cityId: string }) {
  const note = cityPubsOnlyNoteFor(cityId);
  // The stage is read off the document, so a PubMap remount that draws a new
  // stage moves the line with it. The server has no stage and renders nothing.
  const stage = useSyncExternalStore(
    note ? subscribeStage : subscribeNothing,
    stageSnapshot,
    serverStageSnapshot,
  );
  if (!note || !stage) return null;
  return createPortal(<CityPubsOnlyNoteLine note={note} />, stage);
}

function subscribeNothing(): () => void {
  return () => {};
}
