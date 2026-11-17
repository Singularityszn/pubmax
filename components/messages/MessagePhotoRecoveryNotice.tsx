"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { nextMessagePhotoRecovery, subscribeMessagePhotoRecovery } from "@/lib/messagePhotoRecovery";

export default function MessagePhotoRecoveryNotice({ activeConversationId = "" }: { activeConversationId?: string }) {
  const { user, accountRevision } = useAuth();
  const read = useCallback(() => user ? nextMessagePhotoRecovery(`${user.id}:${accountRevision}:`, activeConversationId) : "", [user, accountRevision, activeConversationId]);
  const conversationId = useSyncExternalStore(subscribeMessagePhotoRecovery, read, () => "");
  if (!conversationId) return null;
  return <p className="messagePhotoRecoveryNotice" role="status">
    You have unsent photos. <Link href={`/messages/${encodeURIComponent(conversationId)}`}>Return to your photos</Link>.
  </p>;
}
