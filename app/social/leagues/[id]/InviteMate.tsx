"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { leagueRequest } from "../leagueRequest";

export default function InviteMate({ id }: { id: string }): React.JSX.Element {
  const [mates, setMates] = useState<string[] | null>(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const path = `/api/leagues/${encodeURIComponent(id)}/invite`;

  async function load() {
    setBusy(true);
    const reply = await leagueRequest(path);
    setBusy(false);
    const body = reply.kind === "ok" ? reply.body as { mates?: unknown } | null : null;
    if (Array.isArray(body?.mates) && body.mates.every((mate) => typeof mate === "string")) {
      setMates(body.mates);
      setRecipient(body.mates[0] ?? "");
      setNote(body.mates.length ? null : "No mates to invite yet. Add each other in Social first.");
    } else {
      setNote(reply.kind === "refused" || reply.kind === "closed" ? reply.message : "Your mates didn't load. Try again.");
    }
  }

  async function send() {
    setBusy(true);
    const reply = await leagueRequest(path, { method: "POST", body: JSON.stringify({ recipient }) });
    setBusy(false);
    setNote(reply.kind === "ok"
      ? `Invite sent to @${recipient}. They'll find it in Messages.`
      : reply.kind === "refused" || reply.kind === "closed" ? reply.message : "The invite didn't send. Try again.");
  }

  return (
    <div>
      {mates?.length ? (
        <div className="leaguesActions">
          <label className="leaguesField">
            <span>Invite a mate</span>
            <select value={recipient} disabled={busy} onChange={(event) => setRecipient(event.target.value)}>
              {mates.map((mate) => <option key={mate} value={mate}>@{mate}</option>)}
            </select>
          </label>
          <Button type="button" variant="secondary" disabled={busy || !recipient} onClick={send}>Send invite</Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" disabled={busy} onClick={load}>Invite a mate</Button>
      )}
      {note ? <p className="leaguesNote" role="status">{note}</p> : null}
    </div>
  );
}
