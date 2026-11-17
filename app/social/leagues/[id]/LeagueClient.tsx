"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SiteNav from "@/components/nav/SiteNav";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import { profilePath } from "@/lib/appLink";
import {
  districtsLed,
  formatInviteCode,
  LEAGUE_HUES,
  leagueInvitePath,
  LEAGUES_COPY,
  normalizeInviteCode,
  parseLeagueBoard,
  type LeagueBoard,
} from "@/lib/leagues";
import { rankMatesBoard } from "@/lib/matesBoard";

import LeagueMap from "../LeagueMap";
import InviteMate from "./InviteMate";
import { leagueRequest } from "../leagueRequest";
import "../leagues.css";

type State =
  | { status: "loading" }
  | { status: "ready"; board: LeagueBoard }
  | { status: "signed-out" }
  | { status: "closed"; message: string }
  | { status: "not-open" }
  | { status: "not-found" }
  | { status: "error" };

function nf(value: number): string {
  return value.toLocaleString("en-GB");
}

function Invite({ board, onCode }: { board: LeagueBoard; onCode: (code: string) => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy() {
    const link = new URL(leagueInvitePath(board.league.code), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      setNote(LEAGUES_COPY.copied);
    } catch {
      setNote(link);
    }
  }

  async function renew() {
    setBusy(true);
    const reply = await leagueRequest(`/api/leagues/${encodeURIComponent(board.league.id)}/code`, { method: "POST" });
    setBusy(false);
    const code = reply.kind === "ok" && reply.body && typeof reply.body === "object"
      ? normalizeInviteCode((reply.body as { code?: unknown }).code)
      : null;
    if (code) {
      onCode(code);
      setNote(LEAGUES_COPY.newCodeBody);
    } else {
      setNote(reply.kind === "refused" || reply.kind === "closed" ? reply.message : LEAGUES_COPY.error);
    }
  }

  return (
    <section className="leaguesSection" aria-labelledby="league-invite-title">
      <h2 className="leaguesHeading" id="league-invite-title">{LEAGUES_COPY.inviteTitle}</h2>
      <p className="leaguesCode" aria-label={`Invite code ${board.league.code.split("").join(" ")}`}>
        {formatInviteCode(board.league.code)}
      </p>
      <p className="leaguesNote">{LEAGUES_COPY.inviteBody}</p>
      <div className="leaguesActions">
        <Button type="button" data-primary-action="" onClick={copy}>{LEAGUES_COPY.copyLink}</Button>
        {board.league.owner ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={renew}>{LEAGUES_COPY.newCode}</Button>
        ) : null}
      </div>
      {note ? <p className="leaguesNote" role="status">{note}</p> : null}
      <InviteMate id={board.league.id} />
    </section>
  );
}

function LeaveOrDelete({ board, onGone }: { board: LeagueBoard; onGone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const owner = board.league.owner;
  const base = `/api/leagues/${encodeURIComponent(board.league.id)}`;

  async function go() {
    setBusy(true);
    setProblem(null);
    const reply = owner
      ? await leagueRequest(base, { method: "DELETE" })
      : await leagueRequest(`${base}/leave`, { method: "POST" });
    setBusy(false);
    if (reply.kind === "ok") return onGone();
    setProblem(reply.kind === "refused" || reply.kind === "closed" ? reply.message : LEAGUES_COPY.error);
  }

  return (
    <section className="leaguesSection" aria-label={owner ? LEAGUES_COPY.remove : LEAGUES_COPY.leave}>
      {confirming ? (
        <>
          <p className="leaguesNote">{owner ? LEAGUES_COPY.removeConfirm : "Leave this league? You can join again with its code."}</p>
          <div className="leaguesActions">
            <Button type="button" variant="danger" disabled={busy} onClick={go}>
              {owner ? LEAGUES_COPY.remove : LEAGUES_COPY.leave}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </>
      ) : (
        <div className="leaguesActions">
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
            {owner ? LEAGUES_COPY.remove : LEAGUES_COPY.leave}
          </Button>
        </div>
      )}
      {problem ? <p className="leaguesError" role="alert">{problem}</p> : null}
    </section>
  );
}

function Board({ board, onCode, onGone }: { board: LeagueBoard; onCode: (code: string) => void; onGone: () => void }) {
  const ranked = useMemo(() => rankMatesBoard(board.rows), [board.rows]);
  const hues = useMemo(() => new Map(ranked.map((row, index) => [row.handle, index % LEAGUE_HUES])), [ranked]);
  const led = useMemo(() => districtsLed(board.districts ?? []), [board.districts]);
  const self = board.rows.find((row) => row.self)?.handle ?? null;

  return (
    <>
      <section className="leaguesSection" aria-labelledby="league-board-title">
        <h2 className="leaguesHeading" id="league-board-title">{LEAGUES_COPY.board}</h2>
        <RowList>
          {ranked.map((row) => {
            const districts = led.get(row.handle) ?? 0;
            const meta = [
              `Level ${row.level}`,
              row.owner ? LEAGUES_COPY.ownerTag : null,
              districts > 0 ? `leads ${districts} ${districts === 1 ? "district" : "districts"}` : null,
            ].filter(Boolean).join(" · ");
            return (
              <RowListItem
                key={row.handle}
                href={profilePath(row.handle)}
                lead={
                  <span className="leaguesPlace">
                    <span className={`leagueSwatch leagueHue-${hues.get(row.handle) ?? 0}`} aria-hidden="true" />
                    {row.place}
                  </span>
                }
                title={row.self ? `@${row.handle} (${LEAGUES_COPY.you})` : `@${row.handle}`}
                meta={meta}
                trailing={
                  <span className="leaguesPoints">
                    <span className="leaguesFigure">{nf(row.total)}</span> {row.total === 1 ? "point" : "points"}
                  </span>
                }
              />
            );
          })}
        </RowList>
        {board.status === "degraded" ? <p className="leaguesNote" role="status">{LEAGUES_COPY.degraded}</p> : null}
      </section>
      <Invite board={board} onCode={onCode} />
      <section className="leaguesSection" aria-labelledby="league-map-title">
        <h2 className="leaguesHeading" id="league-map-title">{LEAGUES_COPY.mapTitle}</h2>
        <p className="leaguesNote">{LEAGUES_COPY.mapLede}</p>
        {board.districts ? (
          <LeagueMap districts={board.districts} hueOf={(handle) => hues.get(handle) ?? 0} self={self} />
        ) : (
          <p className="leaguesNote" role="status">{LEAGUES_COPY.mapUnavailable}</p>
        )}
      </section>
      <LeaveOrDelete board={board} onGone={onGone} />
    </>
  );
}

export default function LeagueClient({ id }: { id: string }): React.JSX.Element {
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
    leagueRequest(`/api/leagues/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((reply) => {
        if (reply.kind === "ok") {
          const board = parseLeagueBoard(reply.body);
          update(board ? { status: "ready", board } : { status: "error" });
        } else if (reply.kind === "signed-out" || reply.kind === "not-open") {
          update({ status: reply.kind });
        } else if (reply.kind === "closed") {
          update({ status: "closed", message: reply.message });
        } else if (reply.kind === "refused" && reply.status === 404) {
          update({ status: "not-found" });
        } else {
          update({ status: "error" });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accountRevision, attempt, id, unresolved]);

  const onCode = (code: string) =>
    setResult((current) =>
      current.value.status === "ready"
        ? {
          ...current,
          value: { ...current.value, board: { ...current.value.board, league: { ...current.value.board.league, code } } },
        }
        : current,
    );

  return (
    <div className="leaguesShell">
      <SiteNav />
      <Screen
        as="main"
        id="main"
        kicker={LEAGUES_COPY.kicker}
        title={state.status === "ready" ? state.board.league.name : "League"}
        titleId="league-title"
        secondary={<Link prefetch={false} href="/social/leagues">{LEAGUES_COPY.title}</Link>}
      >
        <div className="leagues" aria-busy={state.status === "loading"}>
          {state.status === "loading" ? (
            <p className="leaguesNote" role="status">Reading the league.</p>
          ) : state.status === "signed-out" ? (
            <EmptyState
              title={LEAGUES_COPY.signIn}
              action={
                <Link prefetch={false} href={`/login?mode=signin&from=${encodeURIComponent(`/social/leagues/${id}`)}`}>
                  Sign in
                </Link>
              }
            />
          ) : state.status === "closed" ? (
            <EmptyState title={state.message} action={<Link prefetch={false} href="/social">Open Social</Link>} />
          ) : state.status === "not-open" ? (
            <EmptyState title={LEAGUES_COPY.notOpen}>{LEAGUES_COPY.notOpenBody}</EmptyState>
          ) : state.status === "not-found" ? (
            <EmptyState title={LEAGUES_COPY.notFound} action={<Link prefetch={false} href="/social/leagues">{LEAGUES_COPY.title}</Link>} />
          ) : state.status === "error" ? (
            <EmptyState
              title="We couldn't read this league."
              action={
                <Button type="button" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Board board={state.board} onCode={onCode} onGone={() => router.push("/social/leagues")} />
          )}
        </div>
      </Screen>
    </div>
  );
}
