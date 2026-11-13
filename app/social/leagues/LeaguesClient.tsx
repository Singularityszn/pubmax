"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SiteNav from "@/components/nav/SiteNav";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import {
  LEAGUE_NAME_MAX,
  LEAGUES_COPY,
  normalizeInviteCode,
  parseLeagueList,
  parseLeagueName,
  type LeagueSummary,
} from "@/lib/leagues";

import { leagueRequest } from "./leagueRequest";
import "./leagues.css";

type State =
  | { status: "loading" }
  | { status: "ready"; leagues: LeagueSummary[] }
  | { status: "signed-out" }
  | { status: "closed"; message: string }
  | { status: "not-open" }
  | { status: "error" };

const leaguePath = (id: string) => `/social/leagues/${encodeURIComponent(id)}` as Route;

/** The id a create or join answered with, or null. */
function answeredId(body: unknown): string | null {
  const id = body && typeof body === "object" ? (body as { id?: unknown }).id : null;
  return typeof id === "string" ? id : null;
}

function StartLeague({ onDone }: { onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseLeagueName(name);
    if (!parsed) {
      setProblem(LEAGUES_COPY.badName);
      return;
    }
    setBusy(true);
    setProblem(null);
    const reply = await leagueRequest("/api/leagues", { method: "POST", body: JSON.stringify({ name: parsed }) });
    setBusy(false);
    const id = reply.kind === "ok" ? answeredId(reply.body) : null;
    if (id) return onDone(id);
    setProblem(
      reply.kind === "refused" || reply.kind === "closed" ? reply.message
        : reply.kind === "not-open" ? LEAGUES_COPY.notOpen
          : reply.kind === "signed-out" ? LEAGUES_COPY.signIn
            : LEAGUES_COPY.error,
    );
  }

  return (
    <section className="leaguesSection" aria-labelledby="league-start-title">
      <h2 className="leaguesHeading" id="league-start-title">{LEAGUES_COPY.create}</h2>
      <form className="leaguesForm" onSubmit={submit}>
        <label className="leaguesField">
          <span>{LEAGUES_COPY.nameLabel}</span>
          <input
            name="name"
            value={name}
            maxLength={LEAGUE_NAME_MAX}
            autoComplete="off"
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button type="submit" data-primary-action="" disabled={busy}>
          {LEAGUES_COPY.create}
        </Button>
      </form>
      {problem ? <p className="leaguesError" role="alert">{problem}</p> : null}
    </section>
  );
}

function JoinLeague({ onDone }: { onDone: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = normalizeInviteCode(code);
    if (!parsed) {
      setProblem(LEAGUES_COPY.badCode);
      return;
    }
    setBusy(true);
    setProblem(null);
    const reply = await leagueRequest("/api/leagues/join", { method: "POST", body: JSON.stringify({ code: parsed }) });
    setBusy(false);
    const id = reply.kind === "ok" ? answeredId(reply.body) : null;
    if (id) return onDone(id);
    setProblem(
      reply.kind === "refused" || reply.kind === "closed" ? reply.message
        : reply.kind === "not-open" ? LEAGUES_COPY.notOpen
          : reply.kind === "signed-out" ? LEAGUES_COPY.signIn
            : LEAGUES_COPY.error,
    );
  }

  return (
    <section className="leaguesSection" aria-labelledby="league-join-title">
      <h2 className="leaguesHeading" id="league-join-title">{LEAGUES_COPY.joinTitle}</h2>
      <form className="leaguesForm" onSubmit={submit}>
        <label className="leaguesField leaguesField--code">
          <span>{LEAGUES_COPY.joinLabel}</span>
          <input
            name="code"
            value={code}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            required
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={busy}>
          {LEAGUES_COPY.join}
        </Button>
      </form>
      <p className="leaguesNote">{LEAGUES_COPY.joinNote}</p>
      {problem ? <p className="leaguesError" role="alert">{problem}</p> : null}
    </section>
  );
}

export default function LeaguesClient(): React.JSX.Element {
  const router = useRouter();
  const { accountRevision } = useAuth();
  const { unresolved } = useViewerSession();
  const [result, setResult] = useState<{ revision: number; value: State }>({
    revision: accountRevision,
    value: { status: "loading" },
  });
  const state: State = !unresolved && result.revision === accountRevision ? result.value : { status: "loading" };
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (unresolved) return;
    const controller = new AbortController();
    const update = (value: State) => {
      if (!controller.signal.aborted) setResult({ revision: accountRevision, value });
    };
    void Promise.resolve().then(() => update({ status: "loading" }));
    leagueRequest("/api/leagues", { signal: controller.signal })
      .then((reply) => {
        if (reply.kind === "ok") {
          const leagues = parseLeagueList(reply.body);
          update(leagues ? { status: "ready", leagues } : { status: "error" });
        } else if (reply.kind === "signed-out" || reply.kind === "not-open") {
          update({ status: reply.kind });
        } else if (reply.kind === "closed") {
          update({ status: "closed", message: reply.message });
        } else {
          update({ status: "error" });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accountRevision, attempt, unresolved]);

  const open = (id: string) => router.push(leaguePath(id));

  return (
    <div className="leaguesShell">
      <SiteNav />
      <Screen
        as="main"
        id="main"
        kicker={LEAGUES_COPY.kicker}
        title={LEAGUES_COPY.title}
        titleId="leagues-title"
        lede={LEAGUES_COPY.lede}
        secondary={<Link prefetch={false} href="/social/leaderboard">You and your mates</Link>}
      >
        <div className="leagues" aria-busy={state.status === "loading"}>
          {state.status === "loading" ? (
            <p className="leaguesNote" role="status">{LEAGUES_COPY.loading}</p>
          ) : state.status === "signed-out" ? (
            <EmptyState
              title={LEAGUES_COPY.signIn}
              action={<Link prefetch={false} href="/login?mode=signin&from=%2Fsocial%2Fleagues">Sign in</Link>}
            />
          ) : state.status === "closed" ? (
            <EmptyState title={state.message} action={<Link prefetch={false} href="/social">Open Social</Link>} />
          ) : state.status === "not-open" ? (
            <EmptyState title={LEAGUES_COPY.notOpen} action={<Link prefetch={false} href="/social/leaderboard">You and your mates</Link>}>
              {LEAGUES_COPY.notOpenBody}
            </EmptyState>
          ) : state.status === "error" ? (
            <EmptyState
              title={LEAGUES_COPY.error}
              action={
                <Button type="button" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
              }
            />
          ) : (
            <>
              {state.leagues.length > 0 ? (
                <RowList label={LEAGUES_COPY.title}>
                  {state.leagues.map((league) => (
                    <RowListItem
                      key={league.id}
                      href={leaguePath(league.id)}
                      title={league.name}
                      meta={league.owner ? LEAGUES_COPY.owner : undefined}
                    />
                  ))}
                </RowList>
              ) : (
                <EmptyState title={LEAGUES_COPY.none}>{LEAGUES_COPY.noneBody}</EmptyState>
              )}
              <StartLeague onDone={open} />
              <JoinLeague onDone={open} />
            </>
          )}
        </div>
      </Screen>
    </div>
  );
}
