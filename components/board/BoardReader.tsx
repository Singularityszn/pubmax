"use client";

// The board reader (review item A4): photograph a pub's price board, let the
// Pal propose the lines, then confirm the ones that are right.
//
// PROPOSE THEN CONFIRM. The read writes nothing. Each card is a proposal the
// drinker can correct (price and measure) or untick, and only the confirm tap
// sends anything: one write per ticked row, through the same community price
// write the venue sheet uses, with this photo as the bill. A food line is shown
// and kept out, because that write takes drink prices only.
//
// Sign-in is read from the one viewer-session seam, never from a null user,
// and the read and the writes both go through the shared contribution gate, so
// a signed-out or unfinished account is asked to sort that first and the photo
// waits for them.

import type { Route } from "next";
import Link from "next/link";
import { useRef, useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";
import MeasureChips from "@/components/map/composer/MeasureChips";
import { Button } from "@/components/ui/button";
import { ARRIVAL_FROM_PARAM } from "@/lib/arrivalWelcome";
import {
  BOARD_READ_CONFIDENCE_LABEL,
  BOARD_READ_FOOD_LINE,
  type BoardReadKeptOut,
} from "@/lib/boardRead";
import { categoryLabel } from "@/lib/drinks";
import { formatGbp } from "@/lib/formatGbp";
import { pickNativePhoto } from "@/lib/nativeCamera";
import { isNativeApp } from "@/lib/nativePlatform";
import { photoRefusal } from "@/lib/pintDropReceipt";

import {
  boardRowDraft,
  confirmBoardRows,
  readBoard,
  type BoardRowDraft,
  type BoardRowOutcome,
} from "./boardReaderClient";

import "./boardReader.css";

type Phase = "photo" | "reading" | "review" | "sending" | "done";

function loginHref(venueId: string): Route {
  const params = new URLSearchParams({ [ARRIVAL_FROM_PARAM]: `/board/${venueId}` });
  return `/login?${params.toString()}` as Route;
}

export default function BoardReader({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const viewer = useViewerSession();
  const { requestContribution, contributionGateDialog } = useContributionGate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("photo");
  const [error, setError] = useState<string | null>(null);
  const [keyless, setKeyless] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRowDraft[]>([]);
  const [keptOut, setKeptOut] = useState<BoardReadKeptOut[]>([]);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, BoardRowOutcome>>(new Map());

  if (keyless) {
    return <p className="boardReaderLine" role="status">{keyless}</p>;
  }

  if (viewer.unresolved) {
    return <p className="boardReaderHint" aria-busy="true">Checking your account</p>;
  }

  if (viewer.signedOut) {
    return (
      <div className="boardReader">
        <p className="boardReaderHint">
          Sign in to read a board. Every price you confirm goes under your name.
        </p>
        <Button asChild>
          <Link prefetch={false} href={loginHref(venueId)}>Sign in</Link>
        </Button>
      </div>
    );
  }

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    const refusal = photoRefusal(file);
    if (refusal) {
      setError(refusal);
      return;
    }
    setError(null);
    setPhoto(file);
    setRows([]);
    setKeptOut([]);
    setOutcomes(new Map());
    setPhase("photo");
  }

  async function openPicker() {
    if (isNativeApp()) {
      const pick = await pickNativePhoto("board");
      if (pick.outcome === "chosen") choosePhoto(pick.file);
      else if (pick.outcome === "blocked") setError(pick.message);
      return;
    }
    inputRef.current?.click();
  }

  async function read() {
    if (!photo || phase === "reading") return;
    const chosen = photo;
    setError(null);
    await requestContribution(async (auth) => {
      setPhase("reading");
      const result = await readBoard(auth, venueId, chosen);
      if (!result.ok) {
        setPhase("photo");
        if (result.kind === "keyless") {
          setKeyless(result.error);
          return;
        }
        if (result.kind === "gate") return { status: result.status, error: result.error };
        setError(result.error);
        return;
      }
      setRows(result.proposals.map(boardRowDraft));
      setKeptOut(result.keptOut);
      setOutcomes(new Map());
      setPhase("review");
    });
  }

  function update(id: string, patch: Partial<BoardRowDraft>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  const pending = rows.filter((row) => row.ticked && outcomes.get(row.id)?.status !== "logged");

  async function confirm() {
    if (!photo || pending.length === 0 || phase === "sending") return;
    const bill = photo;
    const toSend = pending;
    setError(null);
    await requestContribution(async (auth) => {
      setPhase("sending");
      const result = await confirmBoardRows(auth, venueId, toSend, bill);
      setOutcomes((current) => {
        const next = new Map(current);
        for (const outcome of result.outcomes) next.set(outcome.id, outcome);
        return next;
      });
      if (!result.ok) {
        setPhase("review");
        return { status: result.status, error: result.error };
      }
      const allLogged = result.outcomes.every((outcome) => outcome.status === "logged");
      setPhase(allLogged ? "done" : "review");
    });
  }

  const loggedCount = [...outcomes.values()].filter((outcome) => outcome.status === "logged").length;
  const busy = phase === "reading" || phase === "sending";

  return (
    <div className="boardReader">
      <input
        ref={inputRef}
        className="boardReaderInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Photo of the board at ${venueName}`}
        data-testid="board-photo-input"
        onChange={(event) => {
          choosePhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {phase === "photo" || phase === "reading" ? (
        <section className="boardReaderStep" aria-labelledby="board-photo-heading">
          <h2 id="board-photo-heading" className="boardReaderHeading">The board</h2>
          <p className="boardReaderHint">
            One clear photo of the drinks board. The Pal reads the prices and you check each one.
            The photo goes with every price you confirm, as its bill.
          </p>
          <div className="boardReaderActions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void openPicker()}>
              {photo ? "Change the photo" : "Choose a photo"}
            </Button>
            {photo ? (
              <Button type="button" disabled={busy} onClick={() => void read()} data-testid="board-read">
                {phase === "reading" ? "Reading the board" : "Read the board"}
              </Button>
            ) : null}
          </div>
          {photo ? <p className="boardReaderHint">{photo.name}</p> : null}
        </section>
      ) : null}

      {phase === "review" || phase === "sending" || phase === "done" ? (
        <section className="boardReaderStep" aria-labelledby="board-rows-heading">
          <h2 id="board-rows-heading" className="boardReaderHeading">
            {rows.length > 0 ? "Check each price" : "No drink prices on that one"}
          </h2>
          {rows.length > 0 ? (
            <p className="boardReaderHint">
              Fix a price or a measure, untick anything wrong, then log the rest.
              Nothing is logged until you tap.
            </p>
          ) : (
            <p className="boardReaderHint">Try a closer photo of the drinks side of the board.</p>
          )}
          <ul className="boardReaderRows">
            {rows.map((row) => {
              const outcome = outcomes.get(row.id);
              const logged = outcome?.status === "logged";
              return (
                <li key={row.id} className="boardReaderRow" data-testid="board-row">
                  <label className="boardReaderTick">
                    <input
                      type="checkbox"
                      checked={row.ticked}
                      disabled={busy || logged}
                      onChange={(event) => update(row.id, { ticked: event.target.checked })}
                    />
                    <span className="boardReaderName">{row.name}</span>
                  </label>
                  <p className="boardReaderMeta">
                    {categoryLabel(row.category)}. {BOARD_READ_CONFIDENCE_LABEL[row.confidence]}.
                  </p>
                  <label className="boardReaderPrice">
                    <span>Price (£)</span>
                    <input
                      inputMode="decimal"
                      value={row.priceGbp}
                      disabled={busy || logged}
                      aria-label={`Price for ${row.name}`}
                      onChange={(event) => update(row.id, { priceGbp: event.target.value })}
                    />
                  </label>
                  <MeasureChips
                    measure={row.measure}
                    measureLabel={row.measureLabel}
                    fieldLabel={`Measure for ${row.name}`}
                    disabled={busy || logged}
                    onChange={(next) => update(row.id, next)}
                  />
                  {logged ? <p className="boardReaderDone" role="status">Logged</p> : null}
                  {outcome?.status === "refused" ? (
                    <p className="boardReaderError" role="alert">{outcome.error}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {keptOut.length > 0 ? (
            <ul className="boardReaderRows" aria-label="Kept out">
              {keptOut.map((row) => (
                <li key={row.id} className="boardReaderRow boardReaderRow--out">
                  <span className="boardReaderName">{row.name}</span>
                  <span className="boardReaderMeta">
                    {formatGbp(row.pricePence / 100)}. {BOARD_READ_FOOD_LINE}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {phase === "done" ? (
            <p className="boardReaderLine" role="status">
              {loggedCount === 1 ? "One price logged" : `${loggedCount} prices logged`} at {venueName}, dated today.
            </p>
          ) : null}
          <div className="boardReaderActions">
            {pending.length > 0 ? (
              <Button type="button" disabled={busy} onClick={() => void confirm()} data-testid="board-confirm">
                {phase === "sending"
                  ? "Logging"
                  : pending.length === 1
                    ? "Log 1 price"
                    : `Log ${pending.length} prices`}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void openPicker()}>
              Another photo
            </Button>
          </div>
        </section>
      ) : null}

      {error ? <p className="boardReaderError" role="alert">{error}</p> : null}
      {contributionGateDialog}
    </div>
  );
}
