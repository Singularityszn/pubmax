"use client";

import Link from "next/link";
import { Users, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { FRIEND_LOCATION_RECIPIENT_MAX } from "@/lib/friendLocation";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFriendLocations } from "./useFriendLocations";
import { useFriendLocationMarkers } from "./useFriendLocationMarkers";
import "./friendLocations.css";

export default function FriendLocationControl({ map, arrivalPending = false }: { map: MapLibreMap | null; arrivalPending?: boolean }) {
  const { state, client, signedIn, accountKey } = useFriendLocations();
  useFriendLocationMarkers(map, signedIn ? state.friends : []);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ account: string; ids: string[] }>({ account: "", ids: [] });
  const selected = selection.account === accountKey ? selection.ids.filter((id) => state.mutuals.some((friend) => friend.profileId === id)) : [];
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useDismissOnEscape(open, close, control);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !control.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  const sharingLabel = state.status === "revoking" ? "Stopping" : state.status === "revoke-error" ? "Stop unconfirmed" : "Sharing";
  const working = ["starting", "start-unconfirmed", "revoking"].includes(state.status);
  if (arrivalPending && !state.own && !open && !working && state.status !== "revoke-error") return null;
  return <div ref={control} className={`friendLocationControl ph-no-capture${open ? " isOpen" : ""}`}>
    <Button ref={trigger} variant="secondary" aria-label={state.own ? `Friend locations. ${sharingLabel}.` : "Friend locations"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Users size={16} aria-hidden="true" />Friends{state.own && <span className="friendLocationSharingBadge">{sharingLabel}</span>}</Button>
    {open && <section id={id} className="friendLocationPanel" aria-label="Friend locations">
      <div className="friendLocationHeading"><h2>Find your mates</h2><Button variant="ghost" size="icon" aria-label="Close friend locations" onClick={close}><X size={18} aria-hidden="true" /></Button></div>
      {!signedIn ? <p><Link href="/login?next=/map">Sign in</Link> to share with mutual friends.</p> : <>
        <p>Share with selected mates for one hour. Updates pause when this page is hidden. Your point is reduced to about 110 metres.</p>
        <p role="status">{state.message}</p>
        {state.own && <p>Ends {new Date(state.own.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Shared with {state.own.recipients.map((recipient) => state.mutuals.find((friend) => friend.profileId === recipient)?.handle ?? "a selected mate").join(", ")}. Accuracy about {Math.ceil(state.own.accuracy)} metres.</p>}
        {!state.own && state.status !== "starting" && <fieldset><legend>Choose up to {FRIEND_LOCATION_RECIPIENT_MAX} mutual friends</legend>
          {state.mutuals.length === 0 ? <p>No mutual friends yet. <Link href="/social" prefetch={false}>Add a mate in Social</Link>.</p> : state.mutuals.map((friend) => <label key={friend.profileId}>
            <input type="checkbox" checked={selected.includes(friend.profileId)} disabled={!selected.includes(friend.profileId) && selected.length >= FRIEND_LOCATION_RECIPIENT_MAX}
              onChange={(event) => setSelection({ account: accountKey, ids: event.target.checked ? [...selected, friend.profileId] : selected.filter((value) => value !== friend.profileId) })} />{friend.handle}
          </label>)}
        </fieldset>}
        {state.own ? <Button variant="danger" disabled={working} onClick={() => void client.stop()}>{state.status === "revoke-error" ? "Retry Stop sharing" : state.status === "revoking" ? "Stopping sharing…" : "Stop sharing"}</Button>
          : <Button disabled={working || !selected.length} onClick={() => void client.start(selected)}>{state.status === "starting" ? "Starting sharing…" : "Share my location"}</Button>}
        {["error", "start-unconfirmed"].includes(state.status) && <Button variant="ghost" onClick={() => void client.refresh()}>Check locations again</Button>}
        <h3>On the map</h3>
        {state.friends.length === 0 ? <p>No mates sharing a recent location with you.</p> : <ul>{state.friends.map((friend) => <li key={friend.profileId}><strong>{friend.handle}</strong><span>Last seen {new Date(friend.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Accuracy about {Math.ceil(friend.accuracy)} metres.</span></li>)}</ul>}
      </>}
    </section>}
  </div>;
}
