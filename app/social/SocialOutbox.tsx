"use client";

import { useEffect, useState } from "react";

type OutboxItem = { id: string; moderationState: "pending" | "needs_review" };

export default function SocialOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => { void fetch("/api/social/outbox", { cache: "no-store" }).then((response) => response.ok ? response.json() : { posts: [] }).then((value: { posts?: OutboxItem[] }) => setItems(value.posts ?? [])).catch(() => undefined); }, []);
  if (items.length === 0) return null;
  return <section className="socialOutbox" aria-labelledby="social-outbox-title"><h2 id="social-outbox-title">Outbox</h2><ul>{items.map((item) => <li key={item.id}>{item.moderationState === "needs_review" ? "Held for review" : "Moderation pending"}</li>)}</ul></section>;
}
