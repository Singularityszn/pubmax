"use client";

import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";

import { isPlanActiveNow, readActivePlan, subscribeActivePlan } from "@/lib/activePlan";
import {
  msUntilPalNightBoundary,
  PAL_NIGHT_ANSWER_STORAGE_KEY,
  PAL_NIGHT_CHOICES,
  PAL_NIGHT_QUESTION,
  palNightInviteText,
  palNightQuestionOpen,
  readPalNightAnswer,
  writePalNightAnswer,
  type PalNightChoice,
} from "@/lib/palNightQuestion";
import { isClassicPlanInviteToken, planCrewSharePath } from "@/lib/planCrewInviteUrl";
import { ensurePlanInviteToken } from "@/lib/planInviteTokenClient";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";
import { safeLocalStorage } from "@/lib/safeStorage";
import { shareNightObject } from "@/lib/shareSheet";
import { siteOrigin } from "@/lib/siteUrl";
import "./palNightQuestion.css";

// The Pal's evening question on /pal (lib/palNightQuestion.ts). Each answer is
// a link straight into a plan of that shape, and the Pal remembers it for the
// rest of the evening so it never asks twice. An asleep (muted) Pal asks
// nothing, and nothing is asked in the small hours. A page left open checks
// again at noon and at midnight, and when another tab answers.

type Asked = { open: boolean; answer: PalNightChoice | null };

// The crew link leaves the site, so it carries a host, as the plan page's own
// invite does (components/plan/PlanInviteNextStep.tsx).
function absoluteUrl(path: string): string {
  try {
    return new URL(path, siteOrigin(window.location.href) ?? window.location.origin).toString();
  } catch {
    return path;
  }
}

type Crew = { planId: string; inviteUrl: string | null };
type Sent = "idle" | "sent" | "failed";

/**
 * "Who's coming?": once tonight's plan is saved and on, the Pal hands the
 * person its real crew link (`/plan/{id}#invite=…`), so mates join the same
 * night. The invite token is read while the card is on screen, so the tap goes
 * straight to the share sheet. Without a token it opens the plan's own invite
 * tools, and it never shares a bare `/plan/{id}`, which cannot join.
 */
function PalNightCrew({ palName, choice }: { palName: string; choice: PalNightChoice }) {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [sent, setSent] = useState<Sent>("idle");

  useEffect(() => {
    let active = true;
    const read = () => {
      if (!active) return;
      const ref = readActivePlan();
      const planId = ref && (ref.role === "host" || ref.role === "guest") && isPlanActiveNow(ref, Date.now()) ? ref.id : null;
      setCrew(planId ? { planId, inviteUrl: null } : null);
      if (!planId) return;
      void ensurePlanInviteToken(planId).then((token) => {
        if (!active || readActivePlan()?.id !== planId || !token || !isClassicPlanInviteToken(token)) return;
        setCrew({ planId, inviteUrl: absoluteUrl(planCrewSharePath(planId, token)) });
      });
    };
    queueMicrotask(read);
    const unsubscribe = subscribeActivePlan(read);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!crew) return null;
  const invitePage = `/plan/${crew.planId}#share` as Route;
  if (!crew.inviteUrl) {
    return (
      <Link className="palNightQuestionOpen" href={invitePage}>
        Who&apos;s coming?
      </Link>
    );
  }
  const inviteUrl = crew.inviteUrl;
  const share = async () => {
    const outcome = await shareNightObject({ title: "Tonight", text: palNightInviteText(palName, choice), url: inviteUrl });
    setSent(outcome === "failed" ? "failed" : outcome === "cancelled" ? "idle" : "sent");
  };
  return (
    <>
      <button type="button" className="palNightQuestionOpen" onClick={() => void share()}>
        Who&apos;s coming?
      </button>
      {sent === "sent" ? <p className="palNightQuestionNote" role="status">Sent. Now they tap I&apos;m in.</p> : null}
      {sent === "failed" ? (
        <p className="palNightQuestionNote" role="status">
          That didn&apos;t send. <Link href={invitePage}>Send it from the plan</Link>
        </p>
      ) : null}
    </>
  );
}

export default function PalNightQuestion({ muted, palName }: { muted: boolean; palName: string }) {
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
          <PalNightCrew palName={palName} choice={asked.answer} />
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
