"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  msUntilPalNightBoundary,
  PAL_NIGHT_ANSWER_STORAGE_KEY,
  PAL_NIGHT_CHOICES,
  PAL_NIGHT_QUESTION,
  palNightQuestionOpen,
  readPalNightAnswer,
  writePalNightAnswer,
  type PalNightChoice,
} from "@/lib/palNightQuestion";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";
import { safeLocalStorage } from "@/lib/safeStorage";
import "./palNightQuestion.css";

// The Pal's evening question on /pal (lib/palNightQuestion.ts). Each answer is
// a link straight into a plan of that shape, and the Pal remembers it for the
// rest of the evening so it never asks twice. An asleep (muted) Pal asks
// nothing, and nothing is asked in the small hours. A page left open checks
// again at noon and at midnight, and when another tab answers.

type Asked = { open: boolean; answer: PalNightChoice | null };

export default function PalNightQuestion({ muted }: { muted: boolean }) {
  const [asked, setAsked] = useState<Asked | null>(null);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const read = () => {
      if (!active) return;
      const now = new Date();
      setAsked({ open: palNightQuestionOpen(now), answer: readPalNightAnswer(safeLocalStorage(), now) });
      window.clearTimeout(timer);
      // A second past the boundary, so the clock has crossed it.
      timer = window.setTimeout(read, msUntilPalNightBoundary(now) + 1000);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PAL_NIGHT_ANSWER_STORAGE_KEY) read();
    };
    queueMicrotask(read);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (muted || !asked?.open) return null;

  const choose = (choice: PalNightChoice) => {
    writePalNightAnswer(safeLocalStorage(), choice.id, new Date());
    setAsked({ open: true, answer: choice });
  };
  const changeMind = () => {
    writePalNightAnswer(safeLocalStorage(), null, new Date());
    setAsked({ open: true, answer: null });
  };

  if (asked.answer) {
    return (
      <section className="palNightQuestion" aria-label="Tonight" data-testid="pal-night-question">
        <p className="palNightQuestionLine" role="status">{asked.answer.reply}</p>
        <div className="palNightQuestionActions">
          <Link className="palNightQuestionOpen" href={planPalRouteHandoffHref(asked.answer.plan)}>
            Open the plan
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button type="button" className="palNightQuestionChange" onClick={changeMind}>
            Change my mind
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="palNightQuestion" aria-labelledby="pal-night-question-title" data-testid="pal-night-question">
      <p id="pal-night-question-title" className="palNightQuestionLine">{PAL_NIGHT_QUESTION}</p>
      <ul className="palChoiceList palNightQuestionChoices">
        {PAL_NIGHT_CHOICES.map((choice) => (
          <li key={choice.id}>
            <Link className="palChoice" href={planPalRouteHandoffHref(choice.plan)} onClick={() => choose(choice)}>
              <span>{choice.label}</span>
              <small>{choice.hint}</small>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
