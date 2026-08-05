"use client";

import { useEffect, useState } from "react";

type Proposal = { id: string; authorHandle: string; state: "proposed" | "approved" };

export default function SocialTagInbox() {
  const [items, setItems] = useState<Proposal[]>([]);
  const load = () => fetch("/api/social/tags", { cache: "no-store" }).then((response) => response.ok ? response.json() : { proposals: [] }).then((value: { proposals?: Proposal[] }) => setItems(value.proposals ?? [])).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  if (items.length === 0) return null;
  async function act(id: string, action: "approve" | "decline" | "withdraw") {
    await fetch("/api/social/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: id, action }) });
    await load();
  }
  return <section className="socialTagInbox" aria-labelledby="social-tags-title"><h2 id="social-tags-title">Photo tags</h2>{items.map((item) => <div key={item.id}><span>@{item.authorHandle}</span>{item.state === "proposed" ? <><button type="button" onClick={() => void act(item.id, "approve")}>Approve</button><button type="button" onClick={() => void act(item.id, "decline")}>Decline</button></> : <button type="button" onClick={() => void act(item.id, "withdraw")}>Withdraw</button>}</div>)}</section>;
}
