"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { momentHref } from "@/components/nav/navigationModel";
import { Button } from "@/components/ui/button";
import type { PlanClue } from "@/lib/planClues";

import "./planClueHunt.css";

type ClueState = "revealed" | "skipped";

export type PlanClueHuntProps = {
  planId: string;
  clues: readonly PlanClue[];
  onDisable: () => void;
};

/** The loader keys this component to the current member, account and route. */
export default function PlanClueHunt({ planId, clues, onDisable }: PlanClueHuntProps) {
  const headingId = useId();
  const [answers, setAnswers] = useState<Record<string, ClueState>>({});
  const skippedAll = clues.length > 0 && clues.every((clue) => answers[clue.id] === "skipped");
  const finished = clues.filter((clue) => answers[clue.id] !== undefined).length;
  return (
    <section className="planClues" aria-labelledby={headingId}>
      <h3 id={headingId}>London clue hunt</h3>
      <p>Small questions beside your walk. Reveal an answer whenever you like, or skip every clue.</p>
      <p className="planClues__note">No visit or entry is needed. Nearby does not mean visible or accessible from the path.</p>
      <p className="planClues__note">Your progress stays on this page and resets when you reload. Your route stays the same.</p>
      <p role="status">{skippedAll ? "All clues skipped. Carry on with your route." : `${finished} of ${clues.length} clues finished.`}</p>
      <ul className="planClues__list">
        {clues.map((clue, index) => {
          const answerId = `${headingId}-answer-${index}`;
          const state = answers[clue.id];
          return (
            <li className="planClues__item" key={clue.id}>
              <p className="planClues__leg">Between stops {clue.fromIndex + 1} and {clue.toIndex + 1}</p>
              <h4>Clue {index + 1}</h4>
              <p>{clue.question}</p>
              {state === "skipped" ? <p>Skipped.</p> : (
                <div className="planClues__actions">
                  <Button variant="secondary" aria-expanded={state === "revealed"} aria-controls={answerId}
                    onClick={() => setAnswers((current) => ({ ...current, [clue.id]: "revealed" }))}>
                    {state === "revealed" ? "Answer revealed" : `Reveal answer ${index + 1}`}
                  </Button>
                  <Button variant="ghost" onClick={() => setAnswers((current) => ({ ...current, [clue.id]: "skipped" }))}>
                    Skip clue {index + 1}
                  </Button>
                </div>
              )}
              <div id={answerId} hidden={state !== "revealed"}>
                <p><strong>{clue.answer}</strong></p>
                <p>{clue.fact}</p>
                <p className="planClues__note">Source: <a href={clue.source.url} target="_blank" rel="noopener noreferrer">{clue.source.label}</a></p>
              </div>
            </li>
          );
        })}
      </ul>
      <details>
        <summary>Preview the answers and sources</summary>
        <ul>
          {clues.map((clue) => <li key={clue.id}><strong>{clue.answer}.</strong> {clue.fact}{" "}<a href={clue.source.url} target="_blank" rel="noopener noreferrer">{clue.source.label}</a></li>)}
        </ul>
      </details>
      <div className="planClues__actions">
        <Link prefetch={false} href={momentHref(`/plan/${encodeURIComponent(planId)}`)}>Save a memory</Link>
        <Button variant="ghost" onClick={onDisable}>Turn clues off</Button>
      </div>
    </section>
  );
}
