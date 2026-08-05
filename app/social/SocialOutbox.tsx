"use client";

import { useEffect, useState } from "react";

import type { SocialPostDTO } from "@/lib/socialPosts";

import SocialComposer from "./SocialComposer";

type LegacyOutboxItem = {
  id: string;
  moderationState: "pending" | "needs_review";
  revision: number;
  createdAt: string;
};
type OutboxItem = SocialPostDTO | LegacyOutboxItem;

function isPost(item: OutboxItem): item is SocialPostDTO {
  return "body" in item && "ownedByViewer" in item;
}

function mergeItems(
  current: OutboxItem[],
  incoming: OutboxItem[],
): OutboxItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || item.revision >= existing.revision) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function stateLabel(item: OutboxItem): string {
  if (item.moderationState === "needs_review") return "Held for review";
  if (item.moderationState === "pending") return "Moderation pending";
  return "Private";
}

export default function SocialOutbox({
  draftScope,
  submittedPost,
  onPostChanged,
}: {
  draftScope: string | null;
  submittedPost: SocialPostDTO | null;
  onPostChanged: (post?: SocialPostDTO) => void;
}) {
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    let active = true;
    void fetch("/api/social/outbox", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { posts: [] }))
      .then((value: { posts?: OutboxItem[] }) => {
        if (!active) return;
        setItems((current) => mergeItems(current, value.posts ?? []));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [submittedPost?.id, submittedPost?.revision]);

  const visibleItems = submittedPost
    ? mergeItems(items, [submittedPost])
    : items;
  if (visibleItems.length === 0) return null;
  return (
    <section className="socialOutbox" aria-labelledby="social-outbox-title">
      <h2 id="social-outbox-title">Outbox</h2>
      <ul>
        {visibleItems.map((item) => (
          <li key={item.id} className="socialOutboxItem">
            <strong>{stateLabel(item)}</strong>
            {isPost(item) ? (
              <>
                {item.body ? <p>{item.body}</p> : null}
                {draftScope && item.ownedByViewer ? (
                  <SocialComposer
                    post={item}
                    draftScope={draftScope}
                    triggerLabel={
                      item.visibility === "private"
                        ? "Edit private post"
                        : "Edit outbox post"
                    }
                    onSaved={(updated) => {
                      if (updated) {
                        setItems((current) => mergeItems(current, [updated]));
                      }
                      onPostChanged(updated);
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
