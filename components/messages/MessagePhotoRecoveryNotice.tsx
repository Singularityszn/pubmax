"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { nextMessagePhotoRecovery, subscribeMessagePhotoRecovery } from "@/lib/messagePhotoRecovery";

export default function MessagePhotoRecoveryNotice() {
  const { user, accountRevision } = useAuth();
  const read = useCallback(() => user ? nextMessagePhotoRecovery(`${user.id}:${accountRevision}:`) : "", [user, accountRevision]);
  const conversationId = useSyncExternalStore(subscribeMessagePhotoRecovery, read, () => "");
  if (!conversationId) return null;
  return <p className="messagePhotoRecoveryNotice" role="status">
    Photo send paused. <Link href={`/messages/${encodeURIComponent(conversationId)}`}>Return to your photos</Link> to retry.
  </p>;
}
