"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import SiteNav from "@/components/nav/SiteNav";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import { formatInviteCode, leagueInvitePath, LEAGUES_COPY, normalizeInviteCode } from "@/lib/leagues";

import { leagueRequest } from "../../leagueRequest";
import "../../leagues.css";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function JoinLeagueClient({ code: raw }: { code: string }): React.JSX.Element {
  const router = useRouter();
  const { signedOut } = useViewerSession();
  const code = normalizeInviteCode(safeDecode(raw));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function join() {
    if (!code) return;
    setBusy(true);
    setProblem(null);
    const reply = await leagueRequest("/api/leagues/join", { method: "POST", body: JSON.stringify({ code }) });
    const id = reply.kind === "ok" && reply.body && typeof reply.body === "object" ? (reply.body as { id?: unknown }).id : null;
    if (typeof id === "string") {
      router.replace(`/social/leagues/${encodeURIComponent(id)}` as Route);
      return;
    }
    setBusy(false);
    setProblem(
      reply.kind === "refused" || reply.kind === "closed" ? reply.message
        : reply.kind === "not-open" ? LEAGUES_COPY.notOpen
          : reply.kind === "signed-out" ? LEAGUES_COPY.signIn
            : LEAGUES_COPY.error,
    );
  }

  const signIn = code
    ? `/login?mode=signin&from=${encodeURIComponent(leagueInvitePath(code))}`
    : "/login?mode=signin";

  return (
    <div className="leaguesShell">
      <SiteNav />
      <Screen
        as="main"
        id="main"
        kicker={LEAGUES_COPY.kicker}
        title={LEAGUES_COPY.joinTitle}
        titleId="league-join-title"
        lede={code ? LEAGUES_COPY.joinLede : undefined}
        secondary={<Link prefetch={false} href="/social/leagues">{LEAGUES_COPY.title}</Link>}
      >
        <div className="leagues">
          {!code ? (
            <EmptyState title={LEAGUES_COPY.badCode} action={<Link prefetch={false} href="/social/leagues">{LEAGUES_COPY.title}</Link>} />
          ) : (
            <section className="leaguesSection" aria-label={LEAGUES_COPY.joinTitle}>
              <p className="leaguesCode">{formatInviteCode(code)}</p>
              <p className="leaguesNote">{LEAGUES_COPY.joinNote}</p>
              <div className="leaguesActions">
                {signedOut ? (
                  <Button asChild data-primary-action="">
                    <Link prefetch={false} href={signIn as Route}>Sign in to join</Link>
                  </Button>
                ) : (
                  <Button type="button" data-primary-action="" disabled={busy} onClick={join}>
                    {LEAGUES_COPY.join}
                  </Button>
                )}
              </div>
              {problem ? <p className="leaguesError" role="alert">{problem}</p> : null}
            </section>
          )}
        </div>
      </Screen>
    </div>
  );
}
