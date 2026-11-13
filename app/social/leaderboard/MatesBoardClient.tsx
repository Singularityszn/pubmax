"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SiteNav from "@/components/nav/SiteNav";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import { profilePath } from "@/lib/appLink";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  MATES_BOARD_COPY,
  parseMatesBoard,
  rankMatesBoard,
  type MatesBoardAnswer,
} from "@/lib/matesBoard";
import { discardBody } from "@/lib/responseBody";

import "./matesBoard.css";

type State =
  | { status: "loading" }
  | { status: "ready"; board: MatesBoardAnswer }
  | { status: "signed-out" }
  | { status: "closed"; message: string }
  | { status: "error" };

function nf(value: number): string {
  return value.toLocaleString("en-GB");
}

function Board({ board }: { board: MatesBoardAnswer }) {
  const hasMates = board.rows.some((row) => !row.self);
  return (
    <>
      <RowList label={MATES_BOARD_COPY.title}>
        {rankMatesBoard(board.rows).map((row) => (
          <RowListItem
            key={row.handle}
            href={profilePath(row.handle)}
            lead={<span className="matesBoardPlace">{row.place}</span>}
            title={row.self ? `@${row.handle} (${MATES_BOARD_COPY.you})` : `@${row.handle}`}
            meta={`Level ${row.level}`}
            trailing={
              <span className="matesBoardPoints">
                <span className="matesBoardFigure">{nf(row.total)}</span> {row.total === 1 ? "point" : "points"}
              </span>
            }
          />
        ))}
      </RowList>
      {!hasMates ? (
        <EmptyState title={MATES_BOARD_COPY.noMatesTitle} action={<Link prefetch={false} href="/social">Find your lot</Link>}>
          {MATES_BOARD_COPY.noMatesBody}
        </EmptyState>
      ) : null}
      {board.capped ? <p className="matesBoardNote">{MATES_BOARD_COPY.capped}</p> : null}
      {board.status === "degraded" ? (
        <p className="matesBoardNote" role="status">
          {MATES_BOARD_COPY.degraded}
        </p>
      ) : null}
    </>
  );
}

export default function MatesBoardClient(): React.JSX.Element {
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
    void Promise.resolve().then(() => {
      update({ status: "loading" });
    });
    authedActionFetch("/api/social/mates-board", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }, { requiresIdentity: true })
      .then(async (response) => {
        if (response.status === 401) {
          discardBody(response);
          update({ status: "signed-out" });
          return;
        }
        if (response.status === 403) {
          const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
          update({ status: "closed", message: typeof body?.error === "string" ? body.error : MATES_BOARD_COPY.error });
          return;
        }
        if (!response.ok) {
          discardBody(response);
          throw new Error("Mates' board unavailable");
        }
        const board = parseMatesBoard(await response.json());
        if (!board) throw new Error("Mates' board malformed");
        update({ status: "ready", board });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        update({ status: "error" });
      });
    return () => controller.abort();
  }, [accountRevision, attempt, unresolved]);

  return (
    <div className="matesBoardShell">
      <SiteNav />
      <Screen
        as="main"
        id="main"
        kicker={MATES_BOARD_COPY.kicker}
        title={MATES_BOARD_COPY.title}
        titleId="mates-board-title"
        lede={MATES_BOARD_COPY.lede}
        secondary={<Link prefetch={false} href="/social">Back to Social</Link>}
      >
        <section className="matesBoard" aria-labelledby="mates-board-title" aria-busy={state.status === "loading"}>
          {state.status === "loading" ? (
            <p className="matesBoardNote" role="status">{MATES_BOARD_COPY.loading}</p>
          ) : state.status === "signed-out" ? (
            <EmptyState title={MATES_BOARD_COPY.signIn} action={<Link prefetch={false} href="/login?mode=signin&from=%2Fsocial%2Fleaderboard">Sign in</Link>} />
          ) : state.status === "closed" ? (
            <EmptyState title={state.message} action={<Link prefetch={false} href="/social">Open Social</Link>} />
          ) : state.status === "error" ? (
            <EmptyState
              title={MATES_BOARD_COPY.error}
              action={
                <Button type="button" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Board board={state.board} />
          )}
        </section>
      </Screen>
    </div>
  );
}
