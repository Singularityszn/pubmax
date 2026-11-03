"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { isValidRoundCode, normalizeRoundCode } from "@/lib/rounds";
import { useWildNightPreview } from "@/lib/useWildNightPreview";

const RoundRota = dynamic(() => import("./RoundRota"), { ssr: false });

export default function RoundRotaGate({ roundId, roundCode, closedAt, ready }: {
  roundId: string;
  roundCode: string;
  closedAt: string | null;
  ready: boolean;
}) {
  const selected = useWildNightPreview("round-rota");
  const params = useParams<{ code: string }>();
  const { user, session, loading, getCurrentUserId } = useAuth();
  const auth = loading ? null : captureAccountAuth(user?.id ?? null, session);
  const routeCode = normalizeRoundCode(params.code ?? "");
  const scope = `${auth?.userId ?? ""}:${roundId}:${routeCode}`;
  // Once this page observes closure, an older open response cannot restore
  // the tracker. A new account or Round starts its own observation.
  const [lifecycle, setLifecycle] = useState({ scope, closed: closedAt !== null });
  if (lifecycle.scope !== scope) setLifecycle({ scope, closed: closedAt !== null });
  else if (closedAt !== null && !lifecycle.closed) setLifecycle({ scope, closed: true });
  const closed = closedAt !== null || lifecycle.scope === scope && lifecycle.closed;
  if (!selected || !auth || !ready || closed || !roundId || !isValidRoundCode(roundCode) || routeCode !== roundCode) return null;
  return <RoundRota ownerId={auth.userId} roundId={roundId} currentOwnerId={getCurrentUserId} />;
}
